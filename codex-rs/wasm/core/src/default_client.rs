#[derive(Debug, Clone)]
pub struct Originator {
    pub value: String,
}

pub const DEFAULT_ORIGINATOR: &str = "codex_wasm";

pub fn originator() -> Originator {
    Originator {
        value: DEFAULT_ORIGINATOR.to_string(),
    }
}
