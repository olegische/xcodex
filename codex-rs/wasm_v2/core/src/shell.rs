//! Browser compatibility shim for `core` shell metadata.
//!
//! `wasm_v2` does not provide a native shell. These values are retained only so
//! mirrored `core` code can carry the same shell selection metadata shape.

use serde::Deserialize;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;

use crate::shell_snapshot::ShellSnapshot;

#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub enum ShellType {
    Zsh,
    Bash,
    PowerShell,
    Sh,
    Cmd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shell {
    pub(crate) shell_type: ShellType,
    pub(crate) shell_path: PathBuf,
    #[serde(
        skip_serializing,
        skip_deserializing,
        default = "empty_shell_snapshot_receiver"
    )]
    pub(crate) shell_snapshot: watch::Receiver<Option<Arc<ShellSnapshot>>>,
}

impl Shell {
    pub fn name(&self) -> &'static str {
        match self.shell_type {
            ShellType::Zsh => "zsh",
            ShellType::Bash => "bash",
            ShellType::PowerShell => "powershell",
            ShellType::Sh => "sh",
            ShellType::Cmd => "cmd",
        }
    }

    pub fn derive_exec_args(&self, command: &str, use_login_shell: bool) -> Vec<String> {
        let flag = match self.shell_type {
            ShellType::Zsh | ShellType::Bash | ShellType::Sh => {
                if use_login_shell {
                    "-lc"
                } else {
                    "-c"
                }
            }
            ShellType::PowerShell => "-Command",
            ShellType::Cmd => "/C",
        };
        vec![
            self.shell_path.to_string_lossy().to_string(),
            flag.to_string(),
            command.to_string(),
        ]
    }
}

impl PartialEq for Shell {
    fn eq(&self, other: &Self) -> bool {
        self.shell_type == other.shell_type && self.shell_path == other.shell_path
    }
}

impl Eq for Shell {}

pub(crate) fn empty_shell_snapshot_receiver() -> watch::Receiver<Option<Arc<ShellSnapshot>>> {
    let (_tx, rx) = watch::channel(None);
    rx
}

pub fn get_shell(shell_type: ShellType, path: Option<&PathBuf>) -> Option<Shell> {
    let shell_path = path.cloned().unwrap_or_else(|| match shell_type {
        ShellType::Zsh => PathBuf::from("browser://shell/zsh"),
        ShellType::Bash => PathBuf::from("browser://shell/bash"),
        ShellType::PowerShell => PathBuf::from("browser://shell/powershell"),
        ShellType::Sh => PathBuf::from("browser://shell/sh"),
        ShellType::Cmd => PathBuf::from("browser://shell/cmd"),
    });
    Some(Shell {
        shell_type,
        shell_path,
        shell_snapshot: empty_shell_snapshot_receiver(),
    })
}

pub fn default_user_shell() -> Shell {
    get_shell(ShellType::Zsh, None).expect("default shell available")
}
