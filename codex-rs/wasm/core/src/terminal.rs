pub fn user_agent() -> String {
    std::env::var("TERM_PROGRAM")
        .or_else(|_| std::env::var("TERM"))
        .unwrap_or_else(|_| "browser".to_string())
}
