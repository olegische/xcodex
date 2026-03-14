use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use async_channel::Receiver;
use codex_api::Provider as ApiProvider;
use codex_api::RealtimeAudioFrame;
use codex_api::RealtimeEvent;
use codex_protocol::protocol::CodexErrorInfo;
use codex_protocol::protocol::ConversationAudioParams;
use codex_protocol::protocol::ConversationStartParams;
use codex_protocol::protocol::ConversationTextParams;
use codex_protocol::protocol::ErrorEvent;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::RealtimeConversationClosedEvent;
use codex_protocol::protocol::RealtimeConversationStartedEvent;
use http::HeaderMap;
use tokio::sync::Mutex;

use crate::codex::Session;
use crate::error::Result as CodexResult;

pub(crate) struct RealtimeConversationManager {
    running: AtomicBool,
    active_handoff: Mutex<Option<String>>,
}

impl RealtimeConversationManager {
    pub(crate) fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            active_handoff: Mutex::new(None),
        }
    }

    pub(crate) async fn running_state(&self) -> Option<()> {
        self.running.load(Ordering::Relaxed).then_some(())
    }

    pub(crate) async fn start(
        &self,
        _api_provider: ApiProvider,
        _extra_headers: Option<HeaderMap>,
        _prompt: String,
        _model: Option<String>,
        _session_id: Option<String>,
    ) -> CodexResult<(Receiver<RealtimeEvent>, Arc<AtomicBool>)> {
        let (_tx, rx) = async_channel::bounded(1);
        let active = Arc::new(AtomicBool::new(true));
        self.running.store(true, Ordering::Relaxed);
        Ok((rx, active))
    }

    pub(crate) async fn audio_in(&self, _frame: RealtimeAudioFrame) -> CodexResult<()> {
        Ok(())
    }

    pub(crate) async fn text_in(&self, _text: String) -> CodexResult<()> {
        Ok(())
    }

    pub(crate) async fn handoff_out(&self, _output_text: String) -> CodexResult<()> {
        Ok(())
    }

    pub(crate) async fn active_handoff_id(&self) -> Option<String> {
        self.active_handoff.lock().await.clone()
    }

    pub(crate) async fn clear_active_handoff(&self) {
        *self.active_handoff.lock().await = None;
    }

    pub(crate) async fn shutdown(&self) -> CodexResult<()> {
        self.running.store(false, Ordering::Relaxed);
        Ok(())
    }
}

pub(crate) async fn handle_start(
    sess: &Arc<Session>,
    sub_id: String,
    _params: ConversationStartParams,
) -> CodexResult<()> {
    sess.send_event_raw(Event {
        id: sub_id,
        msg: EventMsg::RealtimeConversationStarted(RealtimeConversationStartedEvent {
            session_id: Some(sess.conversation_id.to_string()),
        }),
    })
    .await;
    Ok(())
}

pub(crate) async fn handle_audio(
    _sess: &Arc<Session>,
    _sub_id: String,
    _params: ConversationAudioParams,
) {
}

pub(crate) async fn handle_text(
    sess: &Arc<Session>,
    sub_id: String,
    params: ConversationTextParams,
) {
    if let Err(err) = sess.conversation.text_in(params.text).await {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: err.to_string(),
                codex_error_info: Some(CodexErrorInfo::BadRequest),
            }),
        })
        .await;
    }
}

pub(crate) async fn handle_close(sess: &Arc<Session>, sub_id: String) {
    let _ = sess.conversation.shutdown().await;
    sess.send_event_raw(Event {
        id: sub_id,
        msg: EventMsg::RealtimeConversationClosed(RealtimeConversationClosedEvent {
            reason: Some("closed".to_string()),
        }),
    })
    .await;
}
