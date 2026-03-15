use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;

pub const USER_INSTRUCTIONS_PREFIX: &str = "# AGENTS.md instructions for ";
pub const DEFAULT_BASE_INSTRUCTIONS: &str =
    include_str!("../prompt_with_apply_patch_instructions.md");
const INSTRUCTIONS_OPEN_TAG: &str = "<INSTRUCTIONS>";
const INSTRUCTIONS_CLOSE_TAG: &str = "</INSTRUCTIONS>";
const SKILL_OPEN_TAG: &str = "<skill>";
const SKILL_CLOSE_TAG: &str = "</skill>";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInstructions {
    pub directory: String,
    pub text: String,
}

impl UserInstructions {
    pub fn serialize_to_text(&self) -> String {
        format!(
            "{USER_INSTRUCTIONS_PREFIX}{directory}\n\n{INSTRUCTIONS_OPEN_TAG}\n{text}\n{INSTRUCTIONS_CLOSE_TAG}",
            directory = self.directory,
            text = self.text,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstructions {
    pub name: String,
    pub path: String,
    pub contents: String,
}

impl SkillInstructions {
    pub fn serialize_to_text(&self) -> String {
        format!(
            "{SKILL_OPEN_TAG}\n<name>{name}</name>\n<path>{path}</path>\n{contents}\n{SKILL_CLOSE_TAG}",
            name = self.name,
            path = self.path,
            contents = self.contents,
        )
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionSnapshot {
    pub user_instructions: Option<UserInstructions>,
    pub skills: Vec<SkillInstructions>,
}

impl InstructionSnapshot {
    pub fn is_empty(&self) -> bool {
        self.user_instructions.is_none() && self.skills.is_empty()
    }

    pub fn contextual_user_messages(&self) -> Vec<String> {
        let mut messages =
            Vec::with_capacity(self.skills.len() + usize::from(self.user_instructions.is_some()));
        if let Some(user_instructions) = &self.user_instructions {
            messages.push(user_instructions.serialize_to_text());
        }
        messages.extend(self.skills.iter().map(SkillInstructions::serialize_to_text));
        messages
    }

    pub fn append_to_model_payload(&self, payload: Value) -> Value {
        if self.is_empty() {
            return payload;
        }

        let mut object = match payload {
            Value::Object(map) => map,
            value => {
                let mut map = Map::new();
                map.insert("transportPayload".to_string(), value);
                map
            }
        };

        object.insert(
            "codexInstructions".to_string(),
            serde_json::json!({
                "userInstructions": self.user_instructions,
                "skills": self.skills,
                "contextualUserMessages": self.contextual_user_messages(),
            }),
        );
        Value::Object(object)
    }
}

pub fn with_default_base_instructions(payload: Value) -> Value {
    let mut object = match payload {
        Value::Object(map) => map,
        value => return value,
    };

    let should_insert = match object.get("baseInstructions") {
        Some(Value::String(text)) => text.trim().is_empty(),
        Some(_) => true,
        None => true,
    };

    if should_insert {
        object.insert(
            "baseInstructions".to_string(),
            Value::String(DEFAULT_BASE_INSTRUCTIONS.trim().to_string()),
        );
    }

    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[test]
    fn serializes_agents_instructions_in_codex_format() {
        let instructions = UserInstructions {
            directory: "/repo".to_string(),
            text: "follow repo rules".to_string(),
        };

        assert_eq!(
            instructions.serialize_to_text(),
            "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfollow repo rules\n</INSTRUCTIONS>"
        );
    }

    #[test]
    fn appends_contextual_messages_to_object_payload() {
        let snapshot = InstructionSnapshot {
            user_instructions: Some(UserInstructions {
                directory: "/repo".to_string(),
                text: "follow repo rules".to_string(),
            }),
            skills: vec![SkillInstructions {
                name: "demo-skill".to_string(),
                path: "skills/demo/SKILL.md".to_string(),
                contents: "body".to_string(),
            }],
        };

        assert_eq!(
            snapshot.append_to_model_payload(json!({
                "model": "gpt-5",
                "userMessage": "hello",
            })),
            json!({
                "model": "gpt-5",
                "userMessage": "hello",
                "codexInstructions": {
                    "userInstructions": {
                        "directory": "/repo",
                        "text": "follow repo rules",
                    },
                    "skills": [
                        {
                            "name": "demo-skill",
                            "path": "skills/demo/SKILL.md",
                            "contents": "body",
                        }
                    ],
                    "contextualUserMessages": [
                        "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfollow repo rules\n</INSTRUCTIONS>",
                        "<skill>\n<name>demo-skill</name>\n<path>skills/demo/SKILL.md</path>\nbody\n</skill>",
                    ],
                },
            })
        );
    }

    #[test]
    fn wraps_non_object_payload_before_appending_instructions() {
        let snapshot = InstructionSnapshot {
            user_instructions: Some(UserInstructions {
                directory: "/repo".to_string(),
                text: "follow repo rules".to_string(),
            }),
            skills: Vec::new(),
        };

        assert_eq!(
            snapshot.append_to_model_payload(json!(["raw"])),
            json!({
                "transportPayload": ["raw"],
                "codexInstructions": {
                    "userInstructions": {
                        "directory": "/repo",
                        "text": "follow repo rules",
                    },
                    "skills": [],
                    "contextualUserMessages": [
                        "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfollow repo rules\n</INSTRUCTIONS>",
                    ],
                },
            })
        );
    }

    #[test]
    fn injects_default_base_instructions_when_missing() {
        assert_eq!(
            with_default_base_instructions(json!({ "model": "demo" })),
            json!({
                "model": "demo",
                "baseInstructions": DEFAULT_BASE_INSTRUCTIONS.trim(),
            })
        );
    }

    #[test]
    fn preserves_explicit_base_instructions() {
        assert_eq!(
            with_default_base_instructions(json!({
                "model": "demo",
                "baseInstructions": "custom rules",
            })),
            json!({
                "model": "demo",
                "baseInstructions": "custom rules",
            })
        );
    }
}
