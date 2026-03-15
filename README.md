<p align="center"><strong>XCodex</strong> is a Codex fork focused on the browser-native WASM runtime track.
<p align="center">
  <img src="https://github.com/openai/codex/blob/main/.github/codex-cli-splash.png" alt="Codex CLI splash" width="80%" />
</p>
</br>
This repository keeps the upstream Codex codebase as the reuse base, but its primary development surface is the browser/WASM runtime under [`codex-rs/wasm`](./codex-rs/wasm).
</br>Changes outside that track should stay minimal and are generally limited to workspace wiring or wasm-compatibility work needed to support the browser runtime.</p>

---

## Purpose

This fork is for the browser-native Codex runtime track:

- `codex-rs/wasm` is the main product surface
- upstream `codex-rs/*` is kept primarily as a reuse source
- the goal is not to evolve the native Codex product here, but to preserve and adapt its portable runtime semantics for the browser
- XCodex WASM does not use ChatGPT account login; browser auth is `BYOK` only via provider API keys or router/provider-compatible credentials

## Browser WASM Track

This repository's main track is the browser-native WASM runtime under [`codex-rs/wasm`](./codex-rs/wasm).

The goal is to run real Codex agent/runtime logic in the browser wherever the code is portable, while keeping browser-specific host capabilities on the JavaScript side. In practice, that means:

- `codex-rs/wasm/core` is the Rust agent runtime layer and `codex-rs/wasm/browser` is the browser export/runtime surface
- the browser host provides capabilities such as model transport, storage, and browser-safe tools
- the UI is a shell and debug surface, not the place where agent semantics are rebuilt
- authentication in the browser track is `BYOK`; no ChatGPT account login is part of the XCodex WASM baseline

Security boundary:

- XCodex WASM intentionally does not reuse or expose the native Codex `Sign in with ChatGPT` login flow in the browser.
- That login surface belongs to the upstream native product and has a different trust boundary than a third-party browser-hosted WASM runtime.
- Reintroducing it in a browser fork would create avoidable security and policy risk around OpenAI account auth handling.
- `BYOK` in the browser is an explicit product boundary for this repo, not a claim that browser-stored OpenAI credentials are a production-safe deployment model.
- For OpenAI credentials, the production-grade path remains a backend or relay, not a public browser client.

## Quickstart

### Browser WASM runtime

Start here:

- Official browser demo: [`codex-rs/wasm/apps/webui/README.md`](./codex-rs/wasm/apps/webui/README.md)

That guide covers:

- building the WASM Codex runtime and bundled `xrouter-browser` assets;
- launching the official browser app;
- providing provider/API-key credentials in the UI;
- running the browser-native Codex agent with streaming, tools, citations, and artifacts.

If you only want to try the browser-native Codex runtime, start with that README first.

### Upstream Codex CLI

If you need the standard native Codex CLI flow, install it with your preferred package manager:

```shell
# Install using npm
npm install -g @openai/codex
```

```shell
# Install using Homebrew
brew install --cask codex
```

Then run `codex` to use the upstream native CLI experience.

<details>
<summary>You can also go to the <a href="https://github.com/openai/codex/releases/latest">latest GitHub Release</a> and download the appropriate binary for your platform.</summary>

Each GitHub Release contains many executables, but in practice, you likely want one of these:

- macOS
  - Apple Silicon/arm64: `codex-aarch64-apple-darwin.tar.gz`
  - x86_64 (older Mac hardware): `codex-x86_64-apple-darwin.tar.gz`
- Linux
  - x86_64: `codex-x86_64-unknown-linux-musl.tar.gz`
  - arm64: `codex-aarch64-unknown-linux-musl.tar.gz`

Each archive contains a single entry with the platform baked into the name (e.g., `codex-x86_64-unknown-linux-musl`), so you likely want to rename it to `codex` after extracting it.

</details>

### Upstream Codex ChatGPT login

Run `codex` and select **Sign in with ChatGPT**. We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Team, Edu, or Enterprise plan. [Learn more about what's included in your ChatGPT plan](https://help.openai.com/en/articles/11369540-codex-in-chatgpt).

You can also use Codex with an API key, but this requires [additional setup](https://developers.openai.com/codex/auth#sign-in-with-an-api-key).

This section describes the upstream native CLI flow, not the XCodex WASM track.

## Docs

- [**Codex Documentation**](https://developers.openai.com/codex)
- [**Contributing**](./docs/contributing.md)
- [**Installing & building**](./docs/install.md)
- [**Open source fund**](./docs/open-source-fund.md)

This repository is licensed under the [Apache-2.0 License](LICENSE).
