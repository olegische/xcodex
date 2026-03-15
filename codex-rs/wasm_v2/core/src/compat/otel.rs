#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::SessionTelemetry;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::TelemetryAuthMode;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::Timer;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::context_from_w3c_trace_context;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::current_span_trace_id;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::current_span_w3c_trace_context;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::metrics;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_otel::set_parent_from_w3c_trace_context;

#[cfg(target_arch = "wasm32")]
pub(crate) mod metrics {
    pub(crate) mod names {
        pub(crate) const THREAD_STARTED_METRIC: &str = "codex.thread.started";
        pub(crate) const TURN_E2E_DURATION_METRIC: &str = "codex.turn.e2e.duration";
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TelemetryAuthMode {
    ApiKey,
    Chatgpt,
}

#[cfg(target_arch = "wasm32")]
impl fmt::Display for TelemetryAuthMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ApiKey => write!(f, "api_key"),
            Self::Chatgpt => write!(f, "chatgpt"),
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default)]
pub(crate) struct Timer;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone)]
pub(crate) struct SessionTelemetry {
    model: String,
    slug: String,
    #[allow(dead_code)]
    conversation_id: ThreadId,
}

#[cfg(target_arch = "wasm32")]
impl SessionTelemetry {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        conversation_id: ThreadId,
        model: &str,
        slug: &str,
        _account_id: Option<String>,
        _account_email: Option<String>,
        _auth_mode: Option<TelemetryAuthMode>,
        _originator: String,
        _log_user_prompts: bool,
        _terminal_type: String,
        _session_source: SessionSource,
    ) -> Self {
        Self {
            model: model.to_string(),
            slug: slug.to_string(),
            conversation_id,
        }
    }

    pub(crate) fn with_model(mut self, model: &str, slug: &str) -> Self {
        self.model = model.to_string();
        self.slug = slug.to_string();
        self
    }

    pub(crate) fn with_metrics_service_name(self, _service_name: &str) -> Self {
        self
    }

    pub(crate) fn counter(&self, _name: &str, _inc: i64, _tags: &[(&str, &str)]) {}

    pub(crate) fn start_timer(
        &self,
        _name: &str,
        _tags: &[(&str, &str)],
    ) -> Result<Timer, MetricsError> {
        Err(MetricsError::ExporterDisabled)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn conversation_starts(
        &self,
        _provider_name: &str,
        _reasoning_effort: Option<ReasoningEffort>,
        _reasoning_summary: ReasoningSummary,
        _context_window: Option<i64>,
        _auto_compact_token_limit: Option<i64>,
        _approval_policy: AskForApproval,
        _sandbox_policy: SandboxPolicy,
        _mcp_servers: Vec<&str>,
        _active_profile: Option<String>,
    ) {
    }

    pub(crate) fn user_prompt(&self, _items: &[UserInput]) {}

    pub(crate) fn record_responses(
        &self,
        _handle_responses_span: &Span,
        _event: &crate::compat::api::ResponseEvent,
    ) {
    }

    #[allow(dead_code)]
    pub(crate) fn record_into_history(&self, _items: &[ResponseItem]) {}
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Copy)]
pub(crate) enum MetricsError {
    ExporterDisabled,
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn current_span_w3c_trace_context() -> Option<W3cTraceContext> {
    None
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn current_span_trace_id() -> Option<String> {
    None
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn context_from_w3c_trace_context(_trace: &W3cTraceContext) -> Option<()> {
    None
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn set_parent_from_w3c_trace_context(_span: &Span, _trace: &W3cTraceContext) -> bool {
    false
}
