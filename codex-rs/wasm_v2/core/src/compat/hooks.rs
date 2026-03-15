#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::HookEvent;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::HookEventAfterAgent;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::HookPayload;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::HookResult;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::Hooks;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::HooksConfig;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::SessionStartRequest;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::SessionStartSource;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_hooks::StopRequest;

#[cfg(target_arch = "wasm32")]
use std::path::PathBuf;
#[cfg(target_arch = "wasm32")]
use std::sync::Arc;

#[cfg(target_arch = "wasm32")]
use chrono::DateTime;
#[cfg(target_arch = "wasm32")]
use chrono::SecondsFormat;
#[cfg(target_arch = "wasm32")]
use chrono::Utc;
#[cfg(target_arch = "wasm32")]
use codex_config::ConfigLayerStack;
#[cfg(target_arch = "wasm32")]
use codex_protocol::ThreadId;
#[cfg(target_arch = "wasm32")]
use codex_protocol::protocol::HookCompletedEvent;
#[cfg(target_arch = "wasm32")]
use codex_protocol::protocol::HookRunSummary;
#[cfg(target_arch = "wasm32")]
use futures::future::BoxFuture;
#[cfg(target_arch = "wasm32")]
use serde::Serialize;
#[cfg(target_arch = "wasm32")]
use serde::Serializer;

#[cfg(target_arch = "wasm32")]
pub(crate) type HookFn =
    Arc<dyn for<'a> Fn(&'a HookPayload) -> BoxFuture<'a, HookResult> + Send + Sync>;

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub(crate) enum HookResult {
    Success,
    FailedContinue(Box<dyn std::error::Error + Send + Sync + 'static>),
    FailedAbort(Box<dyn std::error::Error + Send + Sync + 'static>),
}

#[cfg(target_arch = "wasm32")]
impl HookResult {
    pub(crate) fn should_abort_operation(&self) -> bool {
        matches!(self, Self::FailedAbort(_))
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub(crate) struct HookResponse {
    pub(crate) hook_name: String,
    pub(crate) result: HookResult,
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
pub(crate) struct Hook {
    pub(crate) name: String,
    pub(crate) func: HookFn,
}

#[cfg(target_arch = "wasm32")]
impl Default for Hook {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            func: Arc::new(|_| Box::pin(async { HookResult::Success })),
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Hook {
    pub(crate) async fn execute(&self, payload: &HookPayload) -> HookResponse {
        HookResponse {
            hook_name: self.name.clone(),
            result: (self.func)(payload).await,
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub(crate) struct HookPayload {
    pub(crate) session_id: ThreadId,
    pub(crate) cwd: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) client: Option<String>,
    #[serde(serialize_with = "serialize_triggered_at")]
    pub(crate) triggered_at: DateTime<Utc>,
    pub(crate) hook_event: HookEvent,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct HookEventAfterAgent {
    pub(crate) thread_id: ThreadId,
    pub(crate) turn_id: String,
    pub(crate) input_messages: Vec<String>,
    pub(crate) last_assistant_message: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub(crate) enum HookEvent {
    AfterAgent {
        #[serde(flatten)]
        event: HookEventAfterAgent,
    },
}

#[cfg(target_arch = "wasm32")]
fn serialize_triggered_at<S>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&value.to_rfc3339_opts(SecondsFormat::Secs, true))
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Copy)]
pub(crate) enum SessionStartSource {
    Startup,
    Resume,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone)]
pub(crate) struct SessionStartRequest {
    pub(crate) session_id: ThreadId,
    pub(crate) cwd: PathBuf,
    pub(crate) transcript_path: Option<PathBuf>,
    pub(crate) model: String,
    pub(crate) permission_mode: String,
    pub(crate) source: SessionStartSource,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub(crate) struct SessionStartOutcome {
    pub(crate) hook_events: Vec<HookCompletedEvent>,
    pub(crate) should_stop: bool,
    pub(crate) stop_reason: Option<String>,
    pub(crate) additional_context: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone)]
pub(crate) struct StopRequest {
    pub(crate) session_id: ThreadId,
    pub(crate) turn_id: String,
    pub(crate) cwd: PathBuf,
    pub(crate) transcript_path: Option<PathBuf>,
    pub(crate) model: String,
    pub(crate) permission_mode: String,
    pub(crate) stop_hook_active: bool,
    pub(crate) last_assistant_message: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub(crate) struct StopOutcome {
    pub(crate) hook_events: Vec<HookCompletedEvent>,
    pub(crate) should_stop: bool,
    pub(crate) stop_reason: Option<String>,
    pub(crate) should_block: bool,
    pub(crate) block_reason: Option<String>,
    pub(crate) block_message_for_model: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Default, Clone)]
pub(crate) struct HooksConfig {
    pub(crate) legacy_notify_argv: Option<Vec<String>>,
    pub(crate) feature_enabled: bool,
    pub(crate) config_layer_stack: Option<ConfigLayerStack>,
    pub(crate) shell_program: Option<String>,
    pub(crate) shell_args: Vec<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Default)]
pub(crate) struct Hooks {
    after_agent: Vec<Hook>,
}

#[cfg(target_arch = "wasm32")]
impl Hooks {
    pub(crate) fn new(config: HooksConfig) -> Self {
        let _ = config.legacy_notify_argv;
        let _ = config.feature_enabled;
        let _ = config.config_layer_stack;
        let _ = config.shell_program;
        let _ = config.shell_args;
        Self {
            after_agent: Vec::new(),
        }
    }

    pub(crate) fn startup_warnings(&self) -> &[String] {
        &[]
    }

    pub(crate) async fn dispatch(&self, hook_payload: HookPayload) -> Vec<HookResponse> {
        let mut outcomes = Vec::with_capacity(self.after_agent.len());
        for hook in &self.after_agent {
            let outcome = hook.execute(&hook_payload).await;
            let should_abort_operation = outcome.result.should_abort_operation();
            outcomes.push(outcome);
            if should_abort_operation {
                break;
            }
        }
        outcomes
    }

    pub(crate) fn preview_session_start(
        &self,
        _request: &SessionStartRequest,
    ) -> Vec<HookRunSummary> {
        Vec::new()
    }

    pub(crate) async fn run_session_start(
        &self,
        _request: SessionStartRequest,
        _turn_id: Option<String>,
    ) -> SessionStartOutcome {
        SessionStartOutcome {
            hook_events: Vec::new(),
            should_stop: false,
            stop_reason: None,
            additional_context: None,
        }
    }

    pub(crate) fn preview_stop(&self, _request: &StopRequest) -> Vec<HookRunSummary> {
        Vec::new()
    }

    pub(crate) async fn run_stop(&self, _request: StopRequest) -> StopOutcome {
        StopOutcome {
            hook_events: Vec::new(),
            should_stop: false,
            stop_reason: None,
            should_block: false,
            block_reason: None,
            block_message_for_model: None,
        }
    }
}
