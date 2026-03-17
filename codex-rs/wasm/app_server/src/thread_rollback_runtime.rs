use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::ThreadRollbackParams;
use codex_app_server_protocol::ThreadRollbackResponse;
use codex_app_server_protocol::UserInput;
use codex_protocol::protocol::Op;

use crate::AppServerState;
use crate::ThreadRecord;
use crate::models::build_thread;

pub async fn rollback_loaded_thread(
    app_server_state: &mut AppServerState,
    params: ThreadRollbackParams,
) -> Result<ThreadRollbackResponse, JSONRPCErrorError> {
    if params.num_turns == 0 {
        return Err(invalid_request_error("numTurns must be >= 1".to_string()));
    }

    let thread_id = params.thread_id;
    let thread = app_server_state
        .thread(&thread_id)
        .cloned()
        .ok_or_else(|| invalid_request_error(format!("thread not found: {thread_id}")))?;
    if thread.active_turn_id.is_some() {
        return Err(invalid_request_error(
            "Cannot rollback while a turn is in progress.".to_string(),
        ));
    }

    let codex = app_server_state
        .running_thread(&thread_id)
        .ok_or_else(|| invalid_request_error(format!("thread not found: {thread_id}")))?;
    if codex.current_rollout_path().await.is_none() {
        return Err(invalid_request_error(
            "thread rollback requires a persisted rollout path".to_string(),
        ));
    }
    codex
        .submit(Op::ThreadRollback {
            num_turns: params.num_turns,
        })
        .await
        .map_err(internal_error)?;

    let updated = apply_thread_rollback(thread, params.num_turns);
    app_server_state.upsert_thread(updated.clone());

    Ok(ThreadRollbackResponse {
        thread: build_thread(&updated, true, updated.protocol_status()),
    })
}

fn apply_thread_rollback(mut thread: ThreadRecord, num_turns: u32) -> ThreadRecord {
    let turn_ids = thread.turns.keys().cloned().collect::<Vec<_>>();
    let to_remove = usize::try_from(num_turns).unwrap_or(usize::MAX);
    for turn_id in turn_ids.into_iter().rev().take(to_remove) {
        thread.turns.remove(&turn_id);
    }
    thread.preview = preview_from_turns(&thread);
    thread.updated_at = codex_wasm_core::time::now_unix_seconds();
    thread
}

fn preview_from_turns(thread: &ThreadRecord) -> String {
    thread
        .turns
        .values()
        .flat_map(|turn| turn.items.iter())
        .find_map(|item| match item {
            ThreadItem::UserMessage { content, .. } => {
                content.iter().find_map(|input| match input {
                    UserInput::Text { text, .. } => Some(text.trim().to_string()),
                    UserInput::Image { .. }
                    | UserInput::LocalImage { .. }
                    | UserInput::Skill { .. }
                    | UserInput::Mention { .. } => None,
                })
            }
            _ => None,
        })
        .unwrap_or_default()
}

fn invalid_request_error(message: String) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: None,
        message,
    }
}

fn internal_error(error: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;

    use super::apply_thread_rollback;
    use crate::ThreadRecord;
    use crate::TurnRecord;

    #[test]
    fn apply_thread_rollback_drops_latest_turns() {
        let thread = ThreadRecord {
            id: "thread-1".to_string(),
            preview: "preview".to_string(),
            ephemeral: false,
            model_provider: "openai".to_string(),
            cwd: PathBuf::from("/workspace"),
            source: codex_protocol::protocol::SessionSource::Unknown,
            name: Some("Thread".to_string()),
            created_at: 1,
            updated_at: 1,
            archived: false,
            turns: BTreeMap::from([
                (
                    "0001".to_string(),
                    TurnRecord {
                        id: "0001".to_string(),
                        items: vec![codex_app_server_protocol::ThreadItem::UserMessage {
                            id: "item-1".to_string(),
                            content: vec![codex_app_server_protocol::UserInput::Text {
                                text: "First prompt".to_string(),
                                text_elements: Vec::new(),
                            }],
                        }],
                        status: codex_app_server_protocol::TurnStatus::Completed,
                        error: None,
                    },
                ),
                (
                    "0002".to_string(),
                    TurnRecord {
                        id: "0002".to_string(),
                        items: vec![codex_app_server_protocol::ThreadItem::UserMessage {
                            id: "item-2".to_string(),
                            content: vec![codex_app_server_protocol::UserInput::Text {
                                text: "Second prompt".to_string(),
                                text_elements: Vec::new(),
                            }],
                        }],
                        status: codex_app_server_protocol::TurnStatus::Completed,
                        error: None,
                    },
                ),
                (
                    "0003".to_string(),
                    TurnRecord {
                        id: "0003".to_string(),
                        items: vec![codex_app_server_protocol::ThreadItem::UserMessage {
                            id: "item-3".to_string(),
                            content: vec![codex_app_server_protocol::UserInput::Text {
                                text: "Third prompt".to_string(),
                                text_elements: Vec::new(),
                            }],
                        }],
                        status: codex_app_server_protocol::TurnStatus::Completed,
                        error: None,
                    },
                ),
            ]),
            active_turn_id: None,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };

        let updated = apply_thread_rollback(thread, 2);

        assert_eq!(
            updated.turns.keys().cloned().collect::<Vec<_>>(),
            vec!["0001".to_string()]
        );
        assert_eq!(updated.preview, "First prompt".to_string());
    }

    #[test]
    fn apply_thread_rollback_clears_preview_when_no_user_turns_remain() {
        let thread = ThreadRecord {
            id: "thread-1".to_string(),
            preview: "preview".to_string(),
            ephemeral: false,
            model_provider: "openai".to_string(),
            cwd: PathBuf::from("/workspace"),
            source: codex_protocol::protocol::SessionSource::Unknown,
            name: Some("Thread".to_string()),
            created_at: 1,
            updated_at: 1,
            archived: false,
            turns: BTreeMap::from([(
                "0001".to_string(),
                TurnRecord {
                    id: "0001".to_string(),
                    items: vec![codex_app_server_protocol::ThreadItem::UserMessage {
                        id: "item-1".to_string(),
                        content: vec![codex_app_server_protocol::UserInput::Text {
                            text: "Only prompt".to_string(),
                            text_elements: Vec::new(),
                        }],
                    }],
                    status: codex_app_server_protocol::TurnStatus::Completed,
                    error: None,
                },
            )]),
            active_turn_id: None,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };

        let updated = apply_thread_rollback(thread, 1);

        assert!(updated.turns.is_empty());
        assert_eq!(updated.preview, String::new());
    }
}
