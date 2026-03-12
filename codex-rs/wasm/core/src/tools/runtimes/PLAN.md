# WASM Tool Runtimes

This directory is reserved for tool runtime backends that need their own execution layer in WASM.

Examples for later phases:

- browser-backed apply_patch runtime helpers
- Worker-backed compute runtimes
- WASM utility capsule runtimes

Rule:

- runtime helpers belong here only when they are execution backends;
- tool semantics still belong in the main Rust tools subsystem, not in TS host glue.
