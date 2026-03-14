use std::path::Path;
use std::path::PathBuf;

use codex_protocol::ThreadId;
use codex_protocol::protocol::RolloutItem;
use codex_protocol::protocol::SessionMetaLine;

#[derive(Debug, Clone)]
pub(crate) struct ThreadMetadataBuilder {
    pub(crate) id: ThreadId,
    pub(crate) rollout_path: PathBuf,
}

pub(crate) fn builder_from_items(
    items: &[RolloutItem],
    rollout_path: &Path,
) -> Option<ThreadMetadataBuilder> {
    items.iter().find_map(|item| match item {
        RolloutItem::SessionMeta(session_meta) => Some(ThreadMetadataBuilder {
            id: session_meta.meta.id,
            rollout_path: rollout_path.to_path_buf(),
        }),
        _ => None,
    })
}

pub(crate) fn builder_from_session_meta(
    session_meta: &SessionMetaLine,
    rollout_path: &Path,
) -> Option<ThreadMetadataBuilder> {
    Some(ThreadMetadataBuilder {
        id: session_meta.meta.id,
        rollout_path: rollout_path.to_path_buf(),
    })
}
