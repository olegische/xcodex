#[derive(Clone, Debug, Default)]
pub struct DiscoverableTool;

impl From<crate::connectors::AppInfo> for DiscoverableTool {
    fn from(_: crate::connectors::AppInfo) -> Self {
        Self
    }
}
