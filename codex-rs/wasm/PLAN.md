# Codex WASM Plan

## 1. Цель

Собрать браузерную версию Codex (`codex-wasm`), которая работает без нативного бинаря в рантайме браузера и использует только безопасные host-инструменты, предоставленные JS-окружением.

## 2. Что уже подтверждено по текущему репо

- `codex-cli` и TS SDK запускают нативный `codex` как child process (`spawn`), то есть текущий путь исполнения не browser-native.
- `codex-core` и соседние crate'ы завязаны на `tokio::process`, OS sandbox, keyring, PTY, TTY, `git` и другие системные зависимости.
- TUI (`crossterm`) и часть toolchain логики рассчитаны на терминал/STDIN/OS-процессы.
- `codex-app-server` имеет JSON-RPC и транспорт `stdio`/`ws`, но WS сейчас отмечен как experimental/unsupported.
- `codex-app-server-protocol` уже задает существующий клиентский контракт уровня UI/API и должен рассматриваться как основной reuse target для `wasm -> UI`.

Вывод: для настоящего WASM нужен отдельный runtime с четким разделением `agent-core` и `host-capabilities`, но целевая стратегия - максимально переиспользовать существующий runtime Codex, а не переписывать его заново под браузер.

## 3. Область работ (Scope)

### In scope (V1 browser-native)

- Планирование/оркестрация существующего агентного цикла Codex в WASM там, где логика portable.
- Переиспользование `app-server-protocol` как preferred контракта между WASM runtime и UI там, где это practically possible.
- Работа с файлами только через browser-safe host API (виртуальная FS/OPFS/host adapters).
- LLM-вызовы через `fetch`/SSE в браузере.
- Tool runtime через capability-интерфейсы (без прямого `Command::new`).
- Потоковые события, совместимые по смыслу с `app-server`/SDK.
- Browser client package + demo app.

### Out of scope (V1)

- Нативные OS sandbox (`seatbelt`, `landlock`, windows sandbox).
- Полноценный локальный shell/PTY и произвольный `exec`.
- TUI/crossterm.
- Полная byte-to-byte совместимость с текущим нативным CLI поведением.

## 3.1 MVP смысл проекта

MVP больше не формулируется как "browser coding agent, который просто пишет файлы".

Такой сценарий сам по себе слишком слабый:

- если нужен git/repo-centric coding flow, нативный Codex уже сильнее;
- browser runtime должен выигрывать не там, где он хуже desktop/OS, а там, где он локально видит браузерную среду.

Поэтому MVP фиксируется так:

- `codex-rs/wasm` = локальный browser-native agent runtime;
- primary surface = browser investigation/runtime capabilities;
- workspace/file tools = secondary scratch/artifact layer;
- цель MVP = исследовать живую browser environment, запускать локальные probes/scripts, сохранять артефакты в workspace и возвращать инженерный вывод.

Практический MVP use-case:

- пользователь задает вопрос о поведении браузерной среды;
- агент локально инспектирует browser/runtime state;
- при необходимости выполняет JS probes;
- при необходимости пишет вспомогательные файлы/заметки/скрипты в локальный workspace;
- возвращает объяснение, диагностический вывод или generated artifact.

То есть ближайший MVP — это не automation bot и не repo import tool.
Это локальный AI browser runtime с сильным investigation/debugging уклоном.

## 4. Целевая архитектура

## 4.1 Новая директория

`codex-rs/wasm/` становится отдельным subproject в монорепе с минимумом:

- `PLAN.md` (этот документ)
- `ARCHITECTURE.md` (постоянные архитектурные решения и reuse strategy)
- `docs/` (ADR и спецификации контрактов)
- `rust/` (WASM core)
- `ts/` (JS host bridge + browser client)
- `examples/` (браузерный demo)

## 4.2 Принцип разделения

Собрать WASM runtime как отдельную зону под `codex-rs/wasm/`, переиспользуя существующие crate'ы и в первую очередь `codex-core` там, где это возможно без изменения нативной логики, и подключать платформу через адаптеры:

- `FileSystemAdapter`
- `ToolExecutorAdapter`
- `NetworkAdapter`
- `SessionStoreAdapter`
- `Clock/EnvAdapter`
- `TelemetryAdapter`

В браузере эти адаптеры реализуются в JS-хосте, а в WASM приходят как интерфейсные вызовы (serde JSON payload + async bridge).

Ключевой принцип: boundary строится вокруг side effects, а не вокруг всей логики Codex.

То есть приоритет такой:

1. Использовать существующую runtime-логику как есть.
2. Изолировать host-dependent зависимости.
3. Только затем добавлять wasm-local реализации там, где переносимость ломается.

Важно: здесь есть два разных интерфейсных слоя.

1. `wasm -> UI`
   - preferred reuse target: `codex-rs/app-server-protocol`
2. `wasm -> host capabilities`
   - internal bridge contract под `codex-rs/wasm/core/src/bridge.rs`

### 4.2.1 Архитектурное правило для browser runtime

Целевое устройство browser-версии фиксируется так:

- `codex-wasm-core` = почти тот же agent runtime, что и `codex-rs/core`
- browser host = capability provider
- UI = только оболочка и debug/visibility surface

Это означает:

- вся agent semantics должна жить в Rust (`turn loop`, `tool loop`, `follow-up`, `prompt assembly`, `stop conditions`);
- browser host должен предоставлять только side effects / capabilities:
  - model transport
  - virtual workspace fs
  - persistence
  - collaboration callbacks
- UI/TS слой не должен принимать semantic decisions за runtime и не должен быть местом, где "собирается" агентная логика;
- если reuse из `codex-rs/core` невозможен, перенос выполняется максимально близкой wasm-local копией в `codex-rs/wasm/core`, а не новой browser-specific реализацией;
- любые browser/provider-specific преобразования должны быть минимальными и по возможности вытесняться из TS glue в typed runtime/backend слой.

### 4.2.2 Архитектурное правило для tools subsystem

`codex-rs/wasm/core` должен получить отдельную `tools/` подсистему, максимально близкую по структуре к `codex-rs/core/src/tools`.

Цель:

- tools в WASM должны быть отдельной подсистемой, а не набором helper-файлов рядом с browser runtime;
- перенос и синхронизация с upstream `codex-rs/core` должны идти через сопоставимые модули (`spec`, `registry`, `router`, `handlers`, `runtimes`, `context`);
- browser/runtime-specific различия должны оставаться на capability boundary, а не в shape самой tools architecture.

Практическое правило:

- по возможности reuse structure from `codex-rs/core/src/tools`;
- если reuse невозможен, копировать структуру и semantics максимально близко;
- не развивать долгосрочно `tool_loop.rs` / `tool_runtime.rs` как wasm-only архитектуру, расходящуюся с native Codex.

## 4.3 Формат tool runtime

Стандартизировать internal host tool protocol:

- `tool/list`
- `tool/invoke`
- `tool/cancel` (best effort)
- `tool/result` (structured + streaming chunks)

Зафиксированный browser-safe tool set для первого agent runtime:

- `execute_script`
- `inspect_dom`
- `get_visible_text`
- `inspect_storage`
- `inspect_console`
- `inspect_network`
- `update_plan`
- `request_user_input`
- `read_file`
- `write_file`
- `list_dir`
- `grep_files`
- `apply_patch`

Принцип:

- это минимальный набор, при котором multiturn в браузере имеет смысл для browser investigation/runtime agent loop;
- investigation/browser-runtime tools теперь являются primary MVP surface;
- workspace/collaboration tools сохраняются, но рассматриваются как secondary scratch/artifact layer;
- `execute_script` фиксируется как основной browser-native compute primitive;
- V1 не включает shell/process инструменты (`shell`, `exec_command`, `write_stdin`, `unified_exec`, `local_shell`, `js_repl`);
- multi-agent family (`spawn_agent`, `resume_agent`, `wait`, etc.) откладывается до стабилизации single-agent browser runtime;
- дополнительные capability tools (`web_search`, `view_image`, MCP/dynamic tools) рассматриваются как следующий слой, а не baseline.
- `browser-chat-demo` должен быть только UI-срезом реального runtime, а не отдельным demo-local tool loop.

Этапы расширения tool surface фиксируются так:

- V1: Browser Investigation MVP
  - `execute_script`
  - `inspect_dom`
  - `get_visible_text`
  - `inspect_storage`
  - `inspect_console`
  - `inspect_network`
  - `update_plan`
  - `request_user_input`
  - `read_file`
  - `write_file`
  - `list_dir`
  - `grep_files`
  - `apply_patch`
- V2: Browser DevTools Shell
  - `capture_viewport`
  - richer DOM/network/storage inspection contracts
  - better debugging and explanation flows on top of V1 investigation tools
- V3: Advanced Compute
  - `run_worker_task`
  - `execute_wasm_tool`
- V4: Controlled Interaction
  - `navigate_page`
  - `click_element`
  - `fill_form`
  - `request_permission`

Важное продуктовое правило:

- controlled interaction intentionally deferred by default;
- browser page inspection рассматривается как более приоритетный слой, чем browser page manipulation;
- цель `codex-rs/wasm` на ближайших этапах — browser-native investigation runtime и AI DevTools shell, а не automation/RPA agent.

Структурная задача ближайшего этапа:

- выделить текущий WASM tools runtime в отдельную директорию `codex-rs/wasm/core/src/tools/`;
- перенести в нее текущие wasm-local реализации `spec` / `dispatch` / `handlers` без смены поведения;
- дальше расширять tool surface уже внутри этой подсистемы, а не через рост browser-runtime-specific glue.

Модель хранения для browser runtime:

- файлы и generated artifacts хранятся не под `thread_id`, а в отдельном virtual workspace store;
- `workspace_id` владеет деревом файлов и mutation state;
- `thread_id` хранит conversation/session state и ссылается на `workspace_id`;
- logical paths внутри WASM runtime нормализуются в namespace вида `/workspace/...`, а не в реальные OS directories.

## 5. Потоки реализации

## Track A: Browser Runtime MVP (приоритет)

Статус трека:

- [x] A0 завершен
- [x] A1 завершен
- [x] A2 завершен
- [x] A3 завершен
- [x] A4 завершен
- [ ] A5 в работе

### Этап A0. Capability Audit (3-5 дней)

Статус: `completed` (2026-03-04)

- Картировать текущие модули `codex-core` по категориям:
  - `portable`
  - `needs abstraction`
  - `native-only`
- Зафиксировать dependency matrix для `wasm32-unknown-unknown`.
- Определить минимальный V1 feature set (без OS-integrations).

Deliverables:

- `codex-rs/wasm/docs/capability-matrix.md`
- `codex-rs/wasm/docs/feature-scope-v1.md`

Факт выполнения:

- [x] `codex-rs/wasm/docs/capability-matrix.md` создан
- [x] `codex-rs/wasm/docs/feature-scope-v1.md` создан
- [x] Dependency audit выполнен (`cargo tree -p codex-core --target wasm32-unknown-unknown`)

### Этап A1. Core Refactor Boundary (1-2 недели)

Статус: `completed` (2026-03-07)

- Выделить платформенные интерфейсы (traits/ports) вокруг host side effects, чтобы изолировать:
  - process/shell
  - sandbox/policy enforcement
  - filesystem/runtime env
  - network transport
- Составить карту reuse-first для `codex-core` и соседних crate'ов:
  - что можно использовать как есть;
  - что требует host adapter;
  - что придется реализовать или дублировать в `codex-rs/wasm/*`.
- Переиспользовать существующие Rust crate'ы без изменения их логики там, где это возможно.
- Если переиспользование невозможно без изменения native code, копировать portable logic в `codex-rs/wasm/*`.

Deliverables:

- ADR по boundary design.
- Первый `codex-wasm-core` crate, собирающийся для `wasm32`.
- Зафиксированная reuse strategy в `codex-rs/wasm/ARCHITECTURE.md`.

Промежуточный прогресс (2026-03-04):

- [x] Структура wasm перенесена в `codex-rs/wasm` (`core`, `docs`, `PLAN.md`)
- [x] ADR добавлен: `codex-rs/wasm/docs/adr-core-host-boundary.md`
- [x] Добавлен crate `codex-rs/wasm/core` (`codex-wasm-core`) с host boundary traits
- [x] В `codex-wasm-core` добавлены локальные WASM-копии `truncate` и JSON schema/parsing (`JsonSchema`, `parse_tool_input_schema`, sanitizer)
- [x] В `codex-wasm-core` добавлены локальные WASM-копии history utilities: output truncation, token/byte estimators, inline image cost heuristics, API/model-generated item classification
- [x] Зафиксирована reuse-first архитектура для agent loop и orchestration logic из `codex-core`: `codex-rs/wasm/ARCHITECTURE.md`
- [x] Зафиксировано правило cleanup: non-WASM crates не переписываются под WASM; wasm-local logic добавляется только при невозможности прямого reuse
- [x] CI gate на `wasm32-unknown-unknown` для `codex-wasm-core`

### Этап A2. WASM Bridge + Host SDK (1 неделя)

Статус: `completed` (2026-03-07)

- Rust<->JS bridge (`wasm-bindgen` + `serde_wasm_bindgen` или эквивалент) для host capability layer.
- Определить стабильный JSON протокол событий:
  - input events
  - tool requests
  - stream deltas
  - completion/errors
- Реализовать TS host runtime для browser tool adapters.

Deliverables:

- `ts/host-runtime` package.
- Контрактные тесты (golden JSON fixtures).

Промежуточный прогресс (2026-03-07):

- [x] Добавлен Rust wire protocol для bridge: `codex-rs/wasm/core/src/bridge.rs`
- [x] Добавлен Rust `wasm-bindgen` codec layer для bridge: `codex-rs/wasm/core/src/bridge_bindings.rs`
- [x] Добавлен Rust bridge dispatcher поверх `Host*` adapters: `codex-rs/wasm/core/src/bridge_runtime.rs`
- [x] Добавлен kernel entrypoint поверх bridge dispatcher: `codex-rs/wasm/core/src/kernel.rs`
- [x] Добавлен protocol spec: `codex-rs/wasm/docs/bridge-protocol.md`
- [x] Добавлен TS package skeleton: `codex-rs/wasm/ts/host-runtime`
- [x] Добавлены базовые TS runtime tests для host-runtime package
- [x] Добавлены golden JSON fixtures для bridge protocol: `codex-rs/wasm/fixtures/bridge`
- [x] Добавлены cross-language contract tests между Rust и TS поверх общих fixture'ов
- [x] Явно зафиксировано разделение `UI protocol` vs `host bridge` в `codex-rs/wasm/ARCHITECTURE.md`

### Этап A3. Browser Agent Loop MVP (1 неделя)

Статус: `completed` (2026-03-07)

- Запуск turns в браузере на реальном проекте через browser-safe host adapters.
- File ops + apply patch + search + LLM streaming.
- Хранение thread/session в IndexedDB/OPFS.
- Спроектировать reuse path from `app-server-protocol` for `wasm -> UI`.

Deliverables:

- `examples/browser-demo`.
- Демо сценарий: "прочитай проект -> предложи патч -> примени -> покажи diff".

Промежуточный прогресс (2026-03-07):

- [x] Добавлен минимальный browser turn/session runtime: `codex-rs/wasm/core/src/browser_runtime.rs`
- [x] Добавлен browser-facing WASM entrypoint для thread/turn/session runtime: `codex-rs/wasm/core/src/browser_runtime_bindings.rs`
- [x] Зафиксирован reuse path from `app-server-protocol` for `wasm -> UI`: `codex-rs/wasm/docs/ui-protocol-reuse.md`
- [x] Добавить browser host storage adapters для IndexedDB/OPFS
- [x] Добавить `examples/browser-demo`
- [x] Подключить file/search/patch flows в end-to-end turn loop
- [x] Прогнать реальный браузерный demo-run после сборки `wasm32` пакета
- [x] Зафиксировать browser runtime host contract: `codex-rs/wasm/docs/browser-runtime-host.md`
- [x] Закрепить shape `RuntimeDispatch` / `modelDelta` unit-тестами

### Этап A4. Browser API Key + Provider Override Loop (1 неделя)

Статус: `completed` (2026-03-09)

- API key auth path для browser-hosted runtime.
- Browser auth persistence поверх IndexedDB/OPFS.
- Provider-aware browser config surface:
  - direct OpenAI API usage
  - custom provider override (`model_provider`, `base_url`, `env_key`-style host mapping)
  - preferred advanced path: `xrouter-browser` integration for provider-aware routing
- Model discovery in JS host via provider `/models` endpoint:
  - accept OpenAI minimal schema
  - accept richer supersets (for example `xrouter`) as long as `data[].id` exists
- `account/read` + `model/list` + model/provider selection UI.
- Реальный model transport вместо deterministic mock.
- Минимальный browser chat demo: "привет, как дела" -> streamed answer.
- Минимальный browser provider demo: "insert DeepSeek/OpenRouter/XRouter key -> choose provider/model -> stream answer".
- Исследование ChatGPT browser auth compatibility как отдельный, рискованный и неблокирующий трек.
- После этого: timeout/cancel/retry/backpressure для browser model transport.

Deliverables:

- `docs/browser-auth-reuse.md`
- `examples/browser-chat-demo`
- TS adapter(s) for `xrouter-browser` in `codex-rs/wasm`
- Демо сценарий 1: "paste OpenAI API key -> choose model -> send message -> stream answer"
- Демо сценарий 2: "paste provider API key -> select provider override -> choose model -> stream answer"
- Демо сценарий 3: "configure xrouter endpoint -> discover models -> stream answer through `xrouter-browser`"

Промежуточный прогресс (2026-03-07):

- [x] Подтверждено, что текущий CLI ChatGPT login завязан на localhost callback server: `codex-rs/login/src/server.rs`
- [x] Подтверждено, что в `codex-rs/login` уже есть отдельный `device code` flow, который не требует localhost callback server
- [x] Подтверждено, что `app-server-protocol v2` уже содержит browser-friendly путь через `account/login/start` с `chatgptAuthTokens`
- [x] Подтверждено, что `CLIENT_ID` уже является public constant в `codex-rs/core/src/auth.rs`
- [x] Зафиксировать A4 reuse path for browser auth and model selection
- [x] Спроектировать browser host auth adapter
- [x] Зафиксировать развилку: ChatGPT browser auth не является безопасным baseline для продукта, даже если технически исследуем
- [x] Подключить API key auth path к browser runtime
- [x] Определить baseline UX для browser auth/config:
  - user-supplied API key в browser storage для local/dev режима
  - thin relay/service account для product-grade режима
  - router-first config для non-OpenAI backends
- [x] Подключить реальный auth state к browser runtime для API key path
- [x] Подключить `model/list` и browser model picker
- [x] Сделать `examples/browser-chat-demo`
- [x] Сделать воспроизводимую browser-chat-demo сборку через versioned `pkg` manifest
- [x] Перевести `browser-chat-demo` на `Vite + Svelte + TypeScript`
- [x] Подтвердить `browser-chat-demo` через реальный `vite build`
- [x] Заменить demo auth на реальный API key auth в `browser-chat-demo`
- [x] Заменить mock model transport на реальный model transport
- [x] Прогнать live chat demo с реальным provider API key через browser runtime
- [x] Протянуть browser-side provider override config в runtime/demo
- [x] Спроектировать provider model discovery через `/models` в JS host layer
- [ ] Подключить live provider demo для DeepSeek или другого OpenAI-compatible provider
- [x] Проверить совместимость provider override с `xrouter`-style config semantics
- [x] Подтверждено, что `xrouter-browser` теперь существует как отдельный reusable wasm crate: `xrouter/crates/xrouter-browser`
- [x] Завести `XrouterModelTransportAdapter` в browser host runtime слоях `examples/browser-chat-demo`
- [x] Завести `XrouterModelListAdapter` / model discovery adapter поверх `xrouter-browser`
- [x] Завести browser-side codex-compatible provider config store + secret storage
- [x] Подключить generated package from `xrouter-browser` (`wasm-pack` output) в `codex-rs/wasm`
  - без персональных absolute paths в репо
  - через env var или local untracked config (`XROUTER_BROWSER_DIR`)
  - с локальным vendor/cache output внутри `codex-rs/wasm`
- [x] Замаппить `xrouter-contracts::ResponseEvent` -> `codex` `modelStarted/modelDelta/modelCompleted/modelFailed`
- [x] Смокнуть `deepseek` через `xrouter-browser`
- [ ] Добавить browser timeout/cancel semantics для model transport

Факт выполнения (2026-03-09):

- [x] `examples/browser-chat-demo` поддерживает три transport режима:
  - `OpenAI`
  - `XRouter Browser`
  - `OpenAI-compatible server`
- [x] Demo хранит codex-compatible config (`model`, `model_provider`, `model_providers`, `env_key`) и отдельно browser-managed secrets
- [x] `xrouter-browser` интегрирован как browser host transport layer, без переноса router-specific semantics в `codex-rs` core
- [x] Подтвержден end-to-end путь:
  - `UI -> Codex WASM runtime -> browser host adapter -> xrouter-browser -> provider`
- [x] Подтвержден live model discovery через `xrouter-browser.fetchModelIds()`
- [x] Подтвержден live chat turn через `runtime.runTurn(...)` и streamed `modelDelta`
- [x] Зафиксировано требование shared `wasm-bindgen/js-sys/web-sys` runtime between co-located wasm modules

Ограничение текущего A4 vertical slice:

- текущий browser demo уже использует `codex-wasm-core` для orchestration (`runTurn`, `listModels`, thread/session/events),
  но transport payload пока остается упрощенным browser-demo payload, а не полным native `codex-core` prompt assembly;
- в `browser-chat-demo` наружу сейчас уходит в основном `model + userMessage`, без полного native слоя:
  - `base_instructions`
  - model-specific prompt files
  - developer/user instruction layout
  - full tool schema shaping for Responses API
- поэтому A4 можно считать завершенным как transport + browser orchestration milestone,
  но еще нельзя считать его stabilized Codex runtime parity.

### Этап A5. Stabilized Codex Runtime Semantics (2-4 недели)

Статус: `in progress` (2026-03-10, updated)

Цель:

- довести browser runtime от working transport demo до стабилизированного `codex-rs` runtime semantics layer;
- сделать так, чтобы browser/WASM path использовал тот же prompt assembly contract, что и native `codex-core`, а не demo-local `userMessage` transport payload.

Что еще нужно сделать:

- Перенести или переиспользовать native prompt construction path из `codex-rs/core`:
  - `ModelInfo`
  - `get_model_instructions(personality)`
  - `base_instructions`
  - `Prompt`
  - formatted model input layout
- Пробросить assembled `instructions` в browser model transport:
  - `OpenAI-compatible /responses`
  - `xrouter-browser` path
- Расширить demo/runtime config surface для prompt-visible слоев, которые в native Codex влияют на prompt assembly:
  - user-configurable `base instructions`
  - user-configurable `AGENTS.md instructions`
  - user-configurable `skills instructions`
- Зафиксировать и реализовать browser-safe tool runtime поверх virtual workspace store:
  - `read_file`
  - `list_dir`
  - `grep_files`
  - `apply_patch`
  - `update_plan`
  - `request_user_input`
- Развести browser state storage по ролям:
  - `workspace_id` -> files/tree/generated outputs
  - `thread_id` -> turn/session/history/plan state
- Не добавлять ручное поле для environment context в UI:
  - browser runtime должен собирать environment/system context автоматически
  - пользователь не должен руками описывать runtime/browser environment
- Убедиться, что browser runtime не теряет:
  - model prompt files (`gpt_5_1_prompt.md`, `gpt_5_2_prompt.md`, `gpt_5_codex_prompt.md`, etc.)
  - `config.base_instructions`
  - developer instructions
  - AGENTS/skill/user-instruction layout where intended
- Переиспользовать или адаптировать native tool schema shaping:
  - Responses API tools payload
  - approvals / tool visibility semantics where portable
- Добавить browser-visible tracing/debug view для outbound request semantics:
  - какой `instructions` текст собран
  - какие части пришли из persisted config (`base` / `AGENTS` / `skills`)
  - какая часть была synthesized runtime-ом как environment context
  - какие tools видит модель
  - какой provider/model transport выбран
- Добавить parity tests между native и wasm request assembly на фиксированных сценариях:
  - same model
  - same personality
  - same base instructions
  - same user/developer/AGENTS inputs
- Определить явный contract boundary для embedded router mode:
  - что именно `codex-wasm-core` обязан собрать сам
  - что именно host/xrouter transport only executes
- Добавить timeout/cancel/retry/backpressure semantics для browser model transport
- Минимизировать demo-specific glue в `examples/browser-chat-demo` и перенести reusable части в `codex-rs/wasm/*`

Промежуточный прогресс (2026-03-10):

- [x] Добавлен browser-visible instruction layer:
  - `base instructions`
  - `AGENTS.md`
  - `SKILL.md`
- [x] Добавлен codex-style serialization для AGENTS/skill fragments в `codex-wasm-core`
- [x] Browser host contract расширен загрузкой instruction snapshot из browser storage
- [x] Добавлен wasm-local response/tool layer, повторяющий `codex-rs/core` по shape:
  - `FunctionCallError`
  - `build_tool_call(...)`
  - `ToolPayload`
  - `ToolOutput -> ResponseInputItem`
- [x] Добавлен wasm-local browser-safe tool dispatcher, повторяющий core execution path для V1 subset:
  - `handle_output_item_done(...)`
  - `dispatch_tool_call(...)`
  - handlers для `read_file`, `list_dir`, `grep_files`, `apply_patch`, `update_plan`, `request_user_input`
- [x] Tool JSON schemas в `codex-wasm-core` подтянуты ближе к реальным `codex-rs/core` specs
- [x] Browser/WASM model transport расширен до response-item capable event layer:
  - добавлен `OutputItemDone(ResponseItem)` в host/bridge/browser runtime contracts
  - browser demo host начал отдавать завершенные assistant `ResponseItem`
- [x] Core browser runtime начал собирать follow-up payloads через `responseInputItems`
- [x] `browser_runtime_bindings` переведен на JS-backed host adapters и делегирует в core browser runtime вместо отдельного turn loop
- [x] Browser demo host получил реальные capability methods для runtime:
  - `readFile`
  - `listDir`
  - `search`
  - `writeFile`
  - `applyPatch`
  - `updatePlan`
  - `requestUserInput`
- [x] В browser demo появился минимальный virtual workspace store в browser storage с root `/workspace`
- [x] `responseInputItems` начали доходить до browser model transport вместо старого single `userMessage`-only payload path
- [x] Multi-step follow-up orchestration подтвержден в `codex-wasm-core`:
  - `FunctionCall -> tool output -> follow-up model request` закреплен unit-тестом в core runtime
- [x] Browser e2e подтвердил, что exported wasm path действительно крутит живой multi-step tool loop:
  - tools доходят до модели
  - модель возвращает `tool_calls`
  - runtime запускает follow-up requests `turn:1`, `turn:2`, ...
- [x] Exported `wasm32` path больше не только "логически готов":
  - `cargo build -p codex-wasm-core --target wasm32-unknown-unknown --release` проходит
  - `examples/browser-chat-demo/build-demo.sh` проходит через реальную wasm export/package path
- [x] Пробиты реальные wasm export blockers в транзитивных зависимостях:
  - `codex-utils-cache`
  - `codex-utils-image`
  - `codex-git`
- [x] Internal host traits в `codex-wasm-core` переведены на wasm-compatible async boundary (`async_trait(?Send)`) для JS-backed host adapters
- [ ] Не реализован virtual workspace store, отделенный от `thread_id`
- [ ] Browser demo все еще не доказал стабильный browser e2e сценарий на новом exported loop:
  - core multi-step loop уже подтвержден в браузере,
  - но browser host tool backends еще недостаточно совместимы с codex-style payloads для стабильного file workflow
- [ ] Главный текущий блокер сместился в качество browser capability backends, а не в сам turn loop:
  - особенно `apply_patch` в browser host, который должен поддерживать реальные codex-style patch payloads, а не demo-упрощенный subset
- [x] Browser demo получил live visibility поверх реального runtime loop:
  - streamed text deltas
  - tool calls
  - tool outputs
  - realtime turn activity panel в UI
- [x] Browser host `apply_patch` расширен от demo-parser к более реальному capability backend:
  - `*** Begin Patch`
  - `*** Add File:`
  - `*** Update File:`
  - `*** Delete File:`
  - multiple `@@` hunks
  - unified diff fallback (`---` / `+++` / `@@`)
- [x] В `codex-wasm-core` добавлен hard guard на runaway tool loops (`MAX_TOOL_ITERATIONS_PER_TURN`)
- [ ] Не реализована parity-сборка request/tool semantics с native `codex-core`
- [x] Можно считать достигнутым отдельный milestone `working core turn loop`:
  - browser/WASM runtime уже умеет настоящий multi-step Codex-style turn loop
  - tools доходят до модели
  - `function_call -> tool_output -> follow-up request` реально работает
  - exported wasm path и browser bindings участвуют в этом же loop, а не в demo-local orchestration

Текущая точка проекта:

- `codex-wasm-core` как agent/turn loop runtime уже находится в рабочем состоянии;
- основной remaining work сместился из turn orchestration в quality/parity слоя:
  - browser host capability semantics
  - tool runtime reliability
  - prompt/request assembly parity
- это означает, что ближайший фокус должен быть на доведении tool runtime до стабильного уровня, а не на "оживлении" базового loop с нуля.

Следующий обязательный этап:

### Ближайший этап: Tool Runtime Stabilization

Это основной remaining track после достижения `working core turn loop`.

- прогнать и стабилизировать browser e2e сценарий на новом exported wasm bindings path:
  - `OutputItemDone(FunctionCall)` -> dispatch tool
  - `FunctionCallOutput` -> следующий model request
  - file tools через browser host workspace
- довести browser host tools до capability-provider уровня, а не demo-заглушек:
  - в первую очередь `apply_patch`
  - затем `read_file` / `list_dir` / `grep_files` по степени соответствия native semantics
- довести browser workspace semantics до честного file-like contract:
  - persistence
  - content visibility after mutation
  - predictable search/read behavior
- после этого добавить browser e2e stop conditions / diagnostics так, чтобы цикл на плохом tool behavior не выглядел как "подвисший чат"
- прогнать и стабилизировать реальный browser e2e сценарий на file tools
- затем подключить browser workspace store как backend для file tools уже внутри реального runtime loop, а не отдельного demo-layer.

### Следующий этап после стабилизации: Tools Subsystem Refactor

После того как поведение file tools и browser host capabilities стабилизировано, нужно провести structural refactor:

- перенести текущую wasm tools implementation в `codex-rs/wasm/core/src/tools/`
- выровнять структуру под `codex-rs/core/src/tools`
- закрепить дальнейшее расширение tool surface (`V1/V2/V3/V4`) уже внутри этой подсистемы

Это сознательно идет после stabilization, чтобы сначала добить работающий browser tool runtime, а уже потом фиксировать финальную долгосрочную структуру директорий.

Deliverables:

- documented browser prompt assembly contract
- browser runtime, который использует codex-style instructions instead of raw `userMessage`
- parity tests `native vs wasm` for request assembly
- updated browser demo proving:
  - `instructions` are present
  - model-specific prompt selection is preserved
  - provider swap does not erase Codex runtime semantics

Exit criteria for calling the runtime stabilized:

- browser `runTurn` uses codex-style assembled prompt semantics, not a demo-local raw message payload
- provider choice (`OpenAI`, `xrouter-browser`, `OpenAI-compatible`) changes transport only, not Codex instruction semantics
- same turn inputs produce materially equivalent request assembly between native and wasm for covered scenarios
- end-to-end browser demo remains green after removing demo-only shortcuts

### Этап A4-R. ChatGPT Browser Auth Research (отдельный рискованный трек)

Статус: `not started`

- Оценить, можно ли безопасно и легитимно использовать ChatGPT account auth в browser-hosted WASM-клиенте.
- Проверить, возможен ли browser-only popup/redirect + PKCE flow без localhost callback server и без нарушения ожидаемой модели доступа.
- Оценить `device code` как fallback/debug path, а не как baseline UX.
- Не делать этот трек блокером для official API auth path.

Deliverables:

- `docs/browser-auth-reuse.md` с итоговым решением по feasibility/risk
- Явное решение: `research only` или `allowed optional path`

## Track B: Full WASM parity R&D (долгий)

### Этап B1. Compatibility Layer

- Эмуляция подмножества app-server API поверх WASM runtime.
- Определить explicit несовместимости с native CLI.

### Этап B2. Advanced Tools

- Виртуальный `exec` через sandboxed host process bridge.
- Опциональная удаленная execution relay.

### Этап B3. Ecosystem Alignment

- Совместимость со skills/policies/config semantics.
- Миграция части SDK клиентов на wasm backend.

## 6. Технические решения (предварительные)

- Rust target: `wasm32-unknown-unknown`.
- Bridge: `wasm-bindgen`.
- Async в WASM: `wasm-bindgen-futures`.
- Сериализация: `serde` + `serde_json`/`serde_wasm_bindgen`.
- Browser storage: IndexedDB (метаданные) + OPFS (крупные артефакты).
- Streaming model I/O: `fetch` + SSE parser в JS host.

## 7. Тестовая стратегия

- Unit tests:
  - wasm-pack/wasm-bindgen test для core logic.
  - trait-contract tests для adapters.
- Integration tests:
  - browser runner (Playwright) с фикстурами проекта.
  - snapshot tests для event stream payloads.
- Conformance:
  - сравнение последовательности событий `native` vs `wasm` на одинаковых сценариях.

Exit criteria для MVP:

- минимум 3 end-to-end сценария в браузере проходят стабильно.
- patch workflow работает без нативного бинаря.
- известные ограничения формально описаны в документации.

## 8. Риски и как снижать

- Риск: слишком глубокая связанность `codex-core` с нативными зависимостями.
  - Митигация: early capability audit + жесткие boundary traits до начала портирования.
- Риск: деградация качества tool execution без локального shell.
  - Митигация: capability-based tools + optional remote executor.
- Риск: diverging behavior между native и wasm.
  - Митигация: conformance test suite и общая event schema.
- Риск: производительность индексации в браузере.
  - Митигация: инкрементальная индексация + лимиты по размеру + кеш в OPFS.

## 9. План-график (оценка)

- Неделя 1: A0 (аудит + scope freeze).
- Неделя 2-3: A1 (core boundary + wasm-сборка).
- Неделя 4: A2 (bridge + host SDK).
- Неделя 5: A3 (MVP demo в браузере).
- Неделя 6: A4 (hardening + docs + acceptance).

Итого для Browser Runtime MVP: ~6 недель одной небольшой команды.
Full parity (Track B): отдельный многомесячный R&D.

## 10. Decision Gates

- Gate 1 (конец A0): подтверждаем, что V1 scope реализуем без переписывания всего `codex-core`.
- Gate 2 (конец A1): подтверждаем, что есть реалистичный reuse path для agent loop и что `codex-wasm-core` стабильно собирается на `wasm32`.
- Gate 3 (конец A3): браузерный e2e demo проходит без native binary.
- Gate 4 (конец A4): готовность к пилоту с ограниченным набором функций.

## 11. Первые задачи после утверждения плана

1. Создать `capability-matrix.md` с классификацией модулей `codex-rs/core`.
2. Подготовить ADR: `core-host boundary` (traits, event protocol, error model).
3. Сделать `codex-wasm-core` skeleton crate и CI job на `wasm32`.
4. Зафиксировать JSON schema для host tool protocol (request/response/events).
5. Поднять минимальный browser demo с одним рабочим turn.
