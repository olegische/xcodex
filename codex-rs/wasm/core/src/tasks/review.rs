use std::sync::Arc;

use async_trait::async_trait;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ExitedReviewModeEvent;
use codex_protocol::protocol::ReviewOutputEvent;
use codex_protocol::user_input::UserInput;
use tokio_util::sync::CancellationToken;

use super::SessionTask;
use super::SessionTaskContext;
use crate::codex::TurnContext;
use crate::codex::run_turn;
use crate::state::TaskKind;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ReviewTask;

impl ReviewTask {
    pub(crate) fn new() -> Self {
        Self
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl SessionTask for ReviewTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Review
    }

    fn span_name(&self) -> &'static str {
        "session_task.review"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<SessionTaskContext>,
        ctx: Arc<TurnContext>,
        input: Vec<UserInput>,
        cancellation_token: CancellationToken,
    ) -> Option<String> {
        let sess = session.clone_session();
        let output = run_turn(
            sess.clone(),
            ctx.clone(),
            input,
            None,
            cancellation_token.clone(),
        )
        .await;
        if !cancellation_token.is_cancelled() {
            exit_review_mode(sess, output.as_deref().map(parse_review_output_event), ctx).await;
        }
        output
    }

    async fn abort(&self, session: Arc<SessionTaskContext>, ctx: Arc<TurnContext>) {
        exit_review_mode(session.clone_session(), None, ctx).await;
    }
}

fn parse_review_output_event(text: &str) -> ReviewOutputEvent {
    if let Ok(event) = serde_json::from_str::<ReviewOutputEvent>(text) {
        return event;
    }
    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}'))
        && start < end
        && let Some(slice) = text.get(start..=end)
        && let Ok(event) = serde_json::from_str::<ReviewOutputEvent>(slice)
    {
        return event;
    }
    ReviewOutputEvent {
        overall_explanation: text.to_string(),
        ..Default::default()
    }
}

async fn exit_review_mode(
    session: Arc<crate::codex::Session>,
    review_output: Option<ReviewOutputEvent>,
    ctx: Arc<TurnContext>,
) {
    const REVIEW_USER_MESSAGE_ID: &str = "review_rollout_user";
    const REVIEW_ASSISTANT_MESSAGE_ID: &str = "review_rollout_assistant";
    let (user_message, assistant_message) = if let Some(out) = review_output.clone() {
        let mut findings_str = String::new();
        let text = out.overall_explanation.trim();
        if !text.is_empty() {
            findings_str.push_str(text);
        }
        if !out.findings.is_empty() {
            let block = crate::review_format::format_review_findings_block(&out.findings);
            findings_str.push_str(&format!("\n{block}"));
        }
        let rendered =
            crate::client_common::REVIEW_EXIT_SUCCESS_TMPL.replace("{results}", &findings_str);
        let assistant_message = crate::review_format::render_review_output_text(&out);
        (rendered, assistant_message)
    } else {
        let rendered = crate::client_common::REVIEW_EXIT_INTERRUPTED_TMPL.to_string();
        let assistant_message =
            "Review was interrupted. Please re-run /review and wait for it to complete."
                .to_string();
        (rendered, assistant_message)
    };

    session
        .record_conversation_items(
            &ctx,
            &[ResponseItem::Message {
                id: Some(REVIEW_USER_MESSAGE_ID.to_string()),
                role: "user".to_string(),
                content: vec![ContentItem::InputText { text: user_message }],
                end_turn: None,
                phase: None,
            }],
        )
        .await;

    session
        .send_event(
            ctx.as_ref(),
            EventMsg::ExitedReviewMode(ExitedReviewModeEvent { review_output }),
        )
        .await;
    session
        .record_response_item_and_emit_turn_item(
            ctx.as_ref(),
            ResponseItem::Message {
                id: Some(REVIEW_ASSISTANT_MESSAGE_ID.to_string()),
                role: "assistant".to_string(),
                content: vec![ContentItem::OutputText {
                    text: assistant_message,
                }],
                end_turn: None,
                phase: None,
            },
        )
        .await;
    session.ensure_rollout_materialized().await;
}
