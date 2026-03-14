pub use codex_protocol::custom_prompts::CustomPrompt;

use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;

use tokio::fs;

pub fn default_prompts_dir() -> Option<PathBuf> {
    Some(crate::config::find_codex_home().ok()?.join("prompts"))
}

pub async fn discover_prompts_in(dir: &Path) -> Vec<CustomPrompt> {
    discover_prompts_in_excluding(dir, &HashSet::new()).await
}

pub async fn discover_prompts_in_excluding(
    dir: &Path,
    exclude: &HashSet<String>,
) -> Vec<CustomPrompt> {
    let mut out = Vec::new();
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(_) => return out,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let is_file_like = fs::metadata(&path)
            .await
            .map(|m| m.is_file())
            .unwrap_or(false);
        if !is_file_like {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        let Some(name) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if exclude.contains(&name) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path).await else {
            continue;
        };
        out.push(CustomPrompt {
            name,
            path,
            content,
            description: None,
            argument_hint: None,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
