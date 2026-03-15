use serde::Deserialize;
use serde::Serialize;

use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;

pub const USER_INSTRUCTIONS_PREFIX: &str = "# AGENTS.md instructions for ";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename = "user_instructions", rename_all = "snake_case")]
pub(crate) struct UserInstructions {
    pub directory: String,
    pub text: String,
}

impl UserInstructions {
    pub(crate) fn serialize_to_text(&self) -> String {
        format!(
            "{USER_INSTRUCTIONS_PREFIX}{}\n\n<INSTRUCTIONS>\n{}\n</INSTRUCTIONS>",
            self.directory, self.text
        )
    }
}

impl From<UserInstructions> for ResponseItem {
    fn from(ui: UserInstructions) -> Self {
        ResponseItem::Message {
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText {
                text: ui.serialize_to_text(),
            }],
            end_turn: None,
            phase: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename = "skill_instructions", rename_all = "snake_case")]
pub(crate) struct SkillInstructions {
    pub name: String,
    pub path: String,
    pub contents: String,
}

impl From<SkillInstructions> for ResponseItem {
    fn from(si: SkillInstructions) -> Self {
        ResponseItem::Message {
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText {
                text: format!(
                    "<skill>\n<name>{}</name>\n<path>{}</path>\n{}\n</skill>",
                    si.name, si.path, si.contents
                ),
            }],
            end_turn: None,
            phase: None,
        }
    }
}
