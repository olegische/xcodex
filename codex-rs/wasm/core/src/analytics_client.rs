use std::path::PathBuf;
use std::sync::Arc;

use codex_protocol::protocol::SkillScope;

use crate::AuthManager;
use crate::config::Config;

#[derive(Clone)]
pub(crate) struct TrackEventsContext {
    pub(crate) model_slug: String,
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
}

pub(crate) fn build_track_events_context(
    model_slug: String,
    thread_id: String,
    turn_id: String,
) -> TrackEventsContext {
    TrackEventsContext {
        model_slug,
        thread_id,
        turn_id,
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SkillInvocation {
    pub(crate) skill_name: String,
    pub(crate) skill_scope: SkillScope,
    pub(crate) skill_path: PathBuf,
    pub(crate) invocation_type: InvocationType,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum InvocationType {
    Explicit,
    Implicit,
}

pub(crate) struct AppInvocation {
    pub(crate) connector_id: Option<String>,
    pub(crate) app_name: Option<String>,
    pub(crate) invocation_type: Option<InvocationType>,
}

#[derive(Clone, Default)]
pub(crate) struct AnalyticsEventsClient;

impl AnalyticsEventsClient {
    pub(crate) fn new(_config: Arc<Config>, _auth_manager: Arc<AuthManager>) -> Self {
        Self
    }

    pub(crate) fn track_skill_invocations(
        &self,
        tracking: TrackEventsContext,
        invocations: Vec<SkillInvocation>,
    ) {
        let _ = (tracking.model_slug, tracking.thread_id, tracking.turn_id);
        for invocation in invocations {
            let _ = (
                invocation.skill_name,
                invocation.skill_scope,
                invocation.skill_path,
                invocation.invocation_type,
            );
        }
    }

    pub(crate) fn track_app_mentioned(
        &self,
        tracking: TrackEventsContext,
        mentions: Vec<AppInvocation>,
    ) {
        let _ = (tracking.model_slug, tracking.thread_id, tracking.turn_id);
        for mention in mentions {
            let _ = (
                mention.connector_id,
                mention.app_name,
                mention.invocation_type,
            );
        }
    }

    pub(crate) fn track_app_used(&self, tracking: TrackEventsContext, app: AppInvocation) {
        let _ = (tracking.model_slug, tracking.thread_id, tracking.turn_id);
        let _ = (app.connector_id, app.app_name, app.invocation_type);
    }
}
