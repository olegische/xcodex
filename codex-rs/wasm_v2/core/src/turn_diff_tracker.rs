#[derive(Debug, Default)]
pub struct TurnDiffTracker;

impl TurnDiffTracker {
    pub fn new() -> Self {
        Self
    }

    pub fn get_unified_diff(&self) -> Option<String> {
        None
    }
}
