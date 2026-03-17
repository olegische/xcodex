mod compact;
mod ghost_snapshot;
mod regular;
mod review;
mod undo;
mod user_shell;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::select;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use tracing::info_span;
use tracing::warn;

use crate::AuthManager;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::compat::otel::metrics::names::TURN_E2E_DURATION_METRIC;
use crate::compat::task;
use crate::contextual_user_message::TURN_ABORTED_OPEN_TAG;
use crate::event_mapping::parse_turn_item;
use crate::models_manager::manager::ModelsManager;
use crate::protocol::EventMsg;
use crate::protocol::RolloutItem;
use crate::protocol::TokenUsage;
use crate::protocol::TurnAbortReason;
use crate::protocol::TurnAbortedEvent;
use crate::protocol::TurnCompleteEvent;
use crate::state::ActiveTurn;
use crate::state::RunningTask;
use crate::state::TaskKind;
use crate::time::Instant;
use codex_protocol::items::TurnItem;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::user_input::UserInput;

pub(crate) use compact::CompactTask;
pub(crate) use ghost_snapshot::GhostSnapshotTask;
pub use regular::RegularTask;
pub(crate) use review::ReviewTask;
pub(crate) use undo::UndoTask;
pub(crate) use user_shell::UserShellCommandMode;
pub(crate) use user_shell::UserShellCommandTask;
pub(crate) use user_shell::execute_user_shell_command;

const GRACEFULL_INTERRUPTION_TIMEOUT_MS: u64 = 100;
const TURN_ABORTED_INTERRUPTED_GUIDANCE: &str = "The user interrupted the previous turn on purpose. Any running unified exec processes were terminated. If any tools/commands were aborted, they may have partially executed; verify current state before retrying.";

#[derive(Clone)]
pub(crate) struct SessionTaskContext {
    session: Arc<Session>,
}

impl SessionTaskContext {
    pub(crate) fn new(session: Arc<Session>) -> Self {
        Self { session }
    }

    pub(crate) fn clone_session(&self) -> Arc<Session> {
        Arc::clone(&self.session)
    }

    pub(crate) fn auth_manager(&self) -> Arc<AuthManager> {
        Arc::clone(&self.session.services.auth_manager)
    }

    pub(crate) fn models_manager(&self) -> Arc<ModelsManager> {
        Arc::clone(&self.session.services.models_manager)
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub(crate) trait SessionTask: Send + Sync + 'static {
    fn kind(&self) -> TaskKind;

    fn span_name(&self) -> &'static str;

    async fn run(
        self: Arc<Self>,
        _session: Arc<SessionTaskContext>,
        _ctx: Arc<TurnContext>,
        _input: Vec<UserInput>,
        _cancellation_token: CancellationToken,
    ) -> Option<String> {
        None
    }

    async fn abort(&self, _session: Arc<SessionTaskContext>, _ctx: Arc<TurnContext>) {}
}

impl Session {
    pub async fn spawn_task<T: SessionTask>(
        self: &Arc<Self>,
        turn_context: Arc<TurnContext>,
        input: Vec<UserInput>,
        task: T,
    ) {
        self.abort_all_tasks(TurnAbortReason::Replaced).await;
        self.clear_connector_selection().await;

        let task: Arc<dyn SessionTask> = Arc::new(task);
        let task_kind = task.kind();
        let span_name = task.span_name();
        let started_at = Instant::now();
        turn_context
            .turn_timing_state
            .mark_turn_started(started_at)
            .await;
        let token_usage_at_turn_start = self.total_token_usage().await.unwrap_or_default();
        let cancellation_token = CancellationToken::new();
        let done = Arc::new(Notify::new());
        let timer = turn_context
            .session_telemetry
            .start_timer(TURN_E2E_DURATION_METRIC, &[])
            .ok();
        let done_clone = Arc::clone(&done);
        let handle = {
            let session_ctx = Arc::new(SessionTaskContext::new(Arc::clone(self)));
            let ctx = Arc::clone(&turn_context);
            let task_for_run = Arc::clone(&task);
            let task_cancellation_token = cancellation_token.child_token();
            let task_span = info_span!(
                "turn",
                otel.name = span_name,
                thread.id = %self.conversation_id,
                turn.id = %turn_context.sub_id,
                model = %turn_context.model_info.slug,
            );
            task::spawn_task(
                async move {
                    let ctx_for_finish = Arc::clone(&ctx);
                    let last_agent_message = task_for_run
                        .run(
                            Arc::clone(&session_ctx),
                            ctx,
                            input,
                            task_cancellation_token.child_token(),
                        )
                        .await;
                    let sess = session_ctx.clone_session();
                    sess.flush_rollout().await;
                    if !task_cancellation_token.is_cancelled() {
                        sess.on_task_finished(Arc::clone(&ctx_for_finish), last_agent_message)
                            .await;
                    }
                    done_clone.notify_waiters();
                }
                .instrument(task_span),
            )
        };
        let abort_handle = handle.abort_handle();

        let running_task = RunningTask {
            done,
            handle: abort_handle,
            kind: task_kind,
            task,
            cancellation_token,
            turn_context: Arc::clone(&turn_context),
            _timer: timer,
        };
        self.register_new_active_task(running_task, token_usage_at_turn_start)
            .await;
    }

    pub async fn abort_all_tasks(self: &Arc<Self>, reason: TurnAbortReason) {
        if let Some(mut active_turn) = self.take_active_turn().await {
            for task in active_turn.drain_tasks() {
                self.handle_task_abort(task, reason.clone()).await;
            }
            active_turn.clear_pending().await;
        }
        if reason == TurnAbortReason::Interrupted {
            self.close_unified_exec_processes().await;
        }
    }

    pub async fn on_task_finished(
        self: &Arc<Self>,
        turn_context: Arc<TurnContext>,
        last_agent_message: Option<String>,
    ) {
        turn_context
            .turn_metadata_state
            .cancel_git_enrichment_task();

        let mut active = self.active_turn.lock().await;
        let mut pending_input = Vec::<ResponseInputItem>::new();
        let mut should_clear_active_turn = false;
        if let Some(at) = active.as_mut()
            && at.remove_task(&turn_context.sub_id)
        {
            let mut ts = at.turn_state.lock().await;
            pending_input = ts.take_pending_input();
            should_clear_active_turn = true;
        }
        if should_clear_active_turn {
            *active = None;
        }
        drop(active);

        if !pending_input.is_empty() {
            let pending_response_items = pending_input
                .into_iter()
                .map(ResponseItem::from)
                .collect::<Vec<_>>();
            for response_item in pending_response_items {
                if let Some(TurnItem::UserMessage(user_message)) = parse_turn_item(&response_item) {
                    self.record_user_prompt_and_emit_turn_item(
                        turn_context.as_ref(),
                        &user_message.content,
                        response_item,
                    )
                    .await;
                } else {
                    self.record_conversation_items(
                        turn_context.as_ref(),
                        std::slice::from_ref(&response_item),
                    )
                    .await;
                }
            }
        }

        let event = EventMsg::TurnComplete(TurnCompleteEvent {
            turn_id: turn_context.sub_id.clone(),
            last_agent_message,
        });
        self.send_event(turn_context.as_ref(), event).await;
    }

    async fn register_new_active_task(
        &self,
        task: RunningTask,
        token_usage_at_turn_start: TokenUsage,
    ) {
        let mut active = self.active_turn.lock().await;
        let mut turn = ActiveTurn::default();
        let mut turn_state = turn.turn_state.lock().await;
        turn_state.token_usage_at_turn_start = token_usage_at_turn_start;
        drop(turn_state);
        turn.add_task(task);
        *active = Some(turn);
    }

    async fn take_active_turn(&self) -> Option<ActiveTurn> {
        let mut active = self.active_turn.lock().await;
        active.take()
    }

    pub async fn close_unified_exec_processes(self: &Arc<Self>) {
        self.services
            .unified_exec_manager
            .terminate_all_processes()
            .await;
    }

    async fn handle_task_abort(self: &Arc<Self>, task: RunningTask, reason: TurnAbortReason) {
        let sub_id = task.turn_context.sub_id.clone();
        if task.cancellation_token.is_cancelled() {
            return;
        }

        task.cancellation_token.cancel();
        task.turn_context
            .turn_metadata_state
            .cancel_git_enrichment_task();
        let session_task = task.task;

        select! {
            _ = task.done.notified() => {}
            _ = crate::time::sleep(Duration::from_millis(GRACEFULL_INTERRUPTION_TIMEOUT_MS)) => {
                warn!("task {sub_id} didn't complete gracefully after {GRACEFULL_INTERRUPTION_TIMEOUT_MS}ms");
            }
        }

        task.handle.abort();

        let session_ctx = Arc::new(SessionTaskContext::new(Arc::clone(self)));
        session_task
            .abort(session_ctx, Arc::clone(&task.turn_context))
            .await;

        if reason == TurnAbortReason::Interrupted {
            let marker = ResponseItem::Message {
                id: None,
                role: "user".to_string(),
                content: vec![ContentItem::InputText {
                    text: format!(
                        "{TURN_ABORTED_OPEN_TAG}\n{TURN_ABORTED_INTERRUPTED_GUIDANCE}\n</turn_aborted>"
                    ),
                }],
                end_turn: None,
                phase: None,
            };
            self.record_into_history(std::slice::from_ref(&marker), task.turn_context.as_ref())
                .await;
            self.persist_rollout_items(&[RolloutItem::ResponseItem(marker)])
                .await;
            self.flush_rollout().await;
        }

        let event = EventMsg::TurnAborted(TurnAbortedEvent {
            turn_id: Some(task.turn_context.sub_id.clone()),
            reason,
        });
        self.send_event(task.turn_context.as_ref(), event).await;
    }
}
