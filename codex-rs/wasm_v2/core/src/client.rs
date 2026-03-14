use std::sync::Arc;

use codex_otel::SessionTelemetry;
use codex_protocol::config_types::ReasoningSummary as ReasoningSummaryConfig;
use codex_protocol::config_types::ServiceTier;
use codex_protocol::config_types::Verbosity as VerbosityConfig;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
use codex_protocol::protocol::SessionSource;
use tokio::sync::mpsc;

use crate::AuthManager;
use crate::client_common::Prompt;
use crate::client_common::ResponseStream;
use crate::error::Result;
use crate::model_provider_info::ModelProviderInfo;

#[derive(Debug, Clone)]
pub struct ModelClient {
    provider: ModelProviderInfo,
    _auth_manager: Option<Arc<AuthManager>>,
    _conversation_id: codex_protocol::ThreadId,
    _session_source: SessionSource,
    _model_verbosity: Option<VerbosityConfig>,
    responses_websocket_enabled_by_feature: bool,
}

pub struct ModelClientSession {
    client: ModelClient,
}

impl ModelClient {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        auth_manager: Option<Arc<AuthManager>>,
        conversation_id: codex_protocol::ThreadId,
        provider: ModelProviderInfo,
        session_source: SessionSource,
        model_verbosity: Option<VerbosityConfig>,
        responses_websockets_enabled_by_feature: bool,
        _enable_request_compression: bool,
        _include_timing_metrics: bool,
        _beta_features_header: Option<String>,
    ) -> Self {
        Self {
            provider,
            _auth_manager: auth_manager,
            _conversation_id: conversation_id,
            _session_source: session_source,
            _model_verbosity: model_verbosity,
            responses_websocket_enabled_by_feature: responses_websockets_enabled_by_feature,
        }
    }

    pub fn new_session(&self) -> ModelClientSession {
        ModelClientSession {
            client: self.clone(),
        }
    }

    pub async fn compact_conversation_history(
        &self,
        prompt: &Prompt,
        _model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
    ) -> Result<Vec<ResponseItem>> {
        Ok(prompt.input.clone())
    }

    pub fn responses_websocket_enabled(&self, model_info: &ModelInfo) -> bool {
        self.responses_websocket_enabled_by_feature
            && self.provider.supports_websockets
            && model_info.prefer_websockets
    }
}

impl ModelClientSession {
    #[allow(clippy::too_many_arguments)]
    pub async fn prewarm_websocket(
        &mut self,
        _prompt: &Prompt,
        _model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<()> {
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn stream(
        &mut self,
        _prompt: &Prompt,
        _model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        let (_tx, rx) = mpsc::channel(4);
        Ok(ResponseStream { rx_event: rx })
    }

    pub(crate) fn try_switch_fallback_transport(
        &mut self,
        _session_telemetry: &SessionTelemetry,
        model_info: &ModelInfo,
    ) -> bool {
        self.client.responses_websocket_enabled(model_info)
    }
}
