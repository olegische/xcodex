#[derive(Clone, Debug, Default)]
pub struct JsReplHandle;

impl JsReplHandle {
    pub fn with_node_path(
        _node_path: Option<std::path::PathBuf>,
        _module_dirs: Vec<std::path::PathBuf>,
    ) -> Self {
        Self
    }
}

pub async fn resolve_compatible_node(
    _node_path: Option<&std::path::Path>,
) -> Result<(), anyhow::Error> {
    Ok(())
}
