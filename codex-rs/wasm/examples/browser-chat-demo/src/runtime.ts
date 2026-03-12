import type {
  Account,
  AuthState,
  BrowserRuntime,
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  DemoInstructions,
  DemoState,
  DemoTransportMode,
  InstructionSnapshot,
  JsonValue,
  ModelPreset,
  RuntimeDispatch,
  RuntimeActivity,
  WorkspaceDebugFile,
  SessionSnapshot,
  TranscriptEntry,
  XrouterProvider,
} from "./types";

const THREAD_ID = "browser-chat-demo-thread";
const TURN_PREFIX = "browser-chat-demo-turn";
const DB_NAME = "codex-wasm-browser-chat-demo";
const DB_VERSION = 2;
const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
const PREFERRED_API_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"];
const PROVIDER_CONFIG_KEY = "current";
const INSTRUCTIONS_STORAGE_KEY = "codex.wasm.instructions.browser-chat-demo-thread";
const WORKSPACE_STORAGE_KEY = "codex.wasm.workspace.browser-chat-demo";
const WORKSPACE_ROOT = "/workspace";
const OPENAI_PROVIDER_ID = "openai";
const XROUTER_BROWSER_PROVIDER_ID = "xrouter-browser";
const OPENAI_COMPATIBLE_PROVIDER_ID = "external";
const OPENAI_ENV_KEY = "OPENAI_API_KEY";
const XROUTER_ENV_KEY = "XROUTER_API_KEY";
const OPENAI_COMPATIBLE_ENV_KEY = "OPENAI_COMPATIBLE_API_KEY";
const CONNECTED_TOOL_NAMES = [
  "read_file",
  "list_dir",
  "grep_files",
  "apply_patch",
  "update_plan",
  "request_user_input",
] as const;
const DEFAULT_CODEX_CONFIG: CodexCompatibleConfig = {
  model: "",
  modelProvider: XROUTER_BROWSER_PROVIDER_ID,
  modelReasoningEffort: "medium",
  personality: "pragmatic",
  modelProviders: {
    [XROUTER_BROWSER_PROVIDER_ID]: {
      name: "DeepSeek via XRouter Browser",
      baseUrl: DEEPSEEK_API_BASE_URL,
      envKey: XROUTER_ENV_KEY,
      providerKind: "xrouter_browser",
      wireApi: "responses",
      metadata: {
        xrouterProvider: "deepseek",
      },
    },
  },
  env: {
    [XROUTER_ENV_KEY]: "",
  },
};

const DEFAULT_DEMO_INSTRUCTIONS: DemoInstructions = {
  baseInstructions: "",
  agentsDirectory: "/workspace",
  agentsInstructions: "",
  skillName: "browser-skill",
  skillPath: "skills/browser/SKILL.md",
  skillContents: "",
};

type RuntimeModule = {
  default(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  WasmBrowserRuntime: new (host: BrowserRuntimeHost) => BrowserRuntime;
};

type XrouterRuntimeModule = {
  default(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  WasmBrowserClient: new (
    provider: string,
    baseUrl?: string | null,
    apiKey?: string | null,
  ) => XrouterBrowserClient;
};

type XrouterBrowserClient = {
  fetchModelIds(): Promise<unknown>;
  runTextStream(
    requestId: string,
    model: string,
    input: string,
    onEvent: (event: unknown) => void,
  ): Promise<unknown>;
  runResponsesStream(
    requestId: string,
    request: JsonValue,
    onEvent: (event: unknown) => void,
  ): Promise<unknown>;
  cancel(requestId: string): void;
};

type BrowserRuntimeHost = {
  loadSession(threadId: string): Promise<SessionSnapshot | null>;
  loadInstructions(threadId: string): Promise<InstructionSnapshot | null>;
  saveSession(snapshot: SessionSnapshot): Promise<void>;
  loadAuthState(): Promise<AuthState | null>;
  saveAuthState(authState: AuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  readAccount(request: { refreshToken: boolean }): Promise<JsonValue>;
  listModels(request: { cursor: string | null; limit: number | null }): Promise<JsonValue>;
  refreshAuth(context: JsonValue): Promise<JsonValue>;
  readFile(request: JsonValue): Promise<JsonValue>;
  listDir(request: JsonValue): Promise<JsonValue>;
  search(request: JsonValue): Promise<JsonValue>;
  writeFile(request: JsonValue): Promise<JsonValue>;
  applyPatch(request: JsonValue): Promise<JsonValue>;
  updatePlan(request: JsonValue): Promise<void>;
  requestUserInput(request: JsonValue): Promise<JsonValue>;
  startModelTurn(request: JsonValue): Promise<JsonValue>;
  cancelModelTurn(requestId: string): Promise<void>;
};

type HostToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonValue;
};

type ActiveModelRequest =
  | {
      kind: "xrouter";
      requestId: string;
      cancel: () => void;
      isCancelled: () => boolean;
    }
  | {
      kind: "responses";
      requestId: string;
      cancel: () => void;
      isCancelled: () => boolean;
    };

let xrouterModulePromise: Promise<XrouterRuntimeModule> | null = null;
const runtimeActivityListeners = new Set<(activity: RuntimeActivity) => void>();
const activeModelRequests = new Map<string, ActiveModelRequest>();

function emitRuntimeActivity(activity: RuntimeActivity) {
  for (const listener of runtimeActivityListeners) {
    listener(activity);
  }
}

export function subscribeRuntimeActivity(listener: (activity: RuntimeActivity) => void): () => void {
  runtimeActivityListeners.add(listener);
  return () => {
    runtimeActivityListeners.delete(listener);
  };
}

export function connectedToolNames(): string[] {
  return [...CONNECTED_TOOL_NAMES];
}

export function createInitialState(): DemoState {
  return {
    status: "Loading WASM runtime…",
    isError: false,
    runtime: null,
    authState: null,
    codexConfig: structuredClone(DEFAULT_CODEX_CONFIG),
    demoInstructions: structuredClone(DEFAULT_DEMO_INSTRUCTIONS),
    account: null,
    requiresOpenaiAuth: true,
    models: [],
    transcript: [],
    events: [],
    output: "",
  };
}

export async function loadRuntime(): Promise<BrowserRuntime> {
  const manifest = await loadBuildManifest();
  const wasm = (await import(/* @vite-ignore */ toBrowserModuleUrl(manifest.entry, manifest.buildId))) as RuntimeModule;
  await wasm.default({
    module_or_path: toBrowserAssetUrl(manifest.wasm, manifest.buildId),
  });
  return new wasm.WasmBrowserRuntime(createBrowserRuntimeHost());
}

export async function hydrateState(runtime: BrowserRuntime): Promise<Partial<DemoState>> {
  const authState = normalizeHostValue(await runtime.loadAuthState()) as AuthState | null;
  const codexConfig = await loadStoredCodexConfig();
  const demoInstructions = await loadStoredDemoInstructions();
  await deleteStoredSession(THREAD_ID);

  return {
    authState,
    codexConfig,
    demoInstructions,
    transcript: [],
    runtime,
  };
}

export async function loadStoredInstructions(): Promise<DemoInstructions> {
  return loadStoredDemoInstructions();
}

export async function saveStoredInstructions(instructions: DemoInstructions): Promise<DemoInstructions> {
  const normalized = normalizeDemoInstructions(instructions);
  window.localStorage.setItem(
    INSTRUCTIONS_STORAGE_KEY,
    JSON.stringify({
      baseInstructions: normalized.baseInstructions,
      userInstructions:
        normalized.agentsInstructions.length === 0
          ? null
          : {
              directory: normalized.agentsDirectory,
              text: normalized.agentsInstructions,
            },
      skills:
        normalized.skillContents.length === 0
          ? []
          : [
              {
                name: normalized.skillName,
                path: normalized.skillPath,
                contents: normalized.skillContents,
              },
            ],
    }),
  );
  return normalized;
}

export async function saveProviderConfig(
  runtime: BrowserRuntime,
  codexConfig: CodexCompatibleConfig,
): Promise<{ authState: AuthState | null; codexConfig: CodexCompatibleConfig }> {
  void runtime;
  const normalizedConfig = normalizeCodexConfig(codexConfig);
  const apiKey = activeProviderApiKey(normalizedConfig);
  if (apiKey.length === 0) {
    throw new Error("Enter an API key before saving provider config.");
  }

  await saveStoredAuthState({
    authMode: "apiKey",
    openaiApiKey: apiKey,
    accessToken: null,
    refreshToken: null,
    chatgptAccountId: null,
    chatgptPlanType: null,
    lastRefreshAt: null,
  });
  await saveStoredCodexConfig(normalizedConfig);
  return {
    authState: await loadStoredAuthState(),
    codexConfig: normalizedConfig,
  };
}

export async function clearAuth(runtime: BrowserRuntime): Promise<{
  authState: AuthState | null;
  codexConfig: CodexCompatibleConfig;
}> {
  void runtime;
  await clearStoredAuthState();
  await clearStoredCodexConfig();
  return {
    authState: await loadStoredAuthState(),
    codexConfig: structuredClone(DEFAULT_CODEX_CONFIG),
  };
}

export async function readAccount(
  runtime: BrowserRuntime,
): Promise<{ account: Account | null; requiresOpenaiAuth: boolean }> {
  return normalizeHostValue(
    await runtime.readAccount({
      refreshToken: false,
    }),
  ) as { account: Account | null; requiresOpenaiAuth: boolean };
}

export async function listModels(
  runtime: BrowserRuntime,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  return normalizeHostValue(
    await runtime.listModels({
      cursor: null,
      limit: 20,
    }),
  ) as { data: ModelPreset[]; nextCursor: string | null };
}

export async function loadStoredBrowserAuthState(): Promise<AuthState | null> {
  return loadStoredAuthState();
}

export async function runChatTurn(
  runtime: BrowserRuntime,
  authState: AuthState | null,
  account: Account | null,
  codexConfig: CodexCompatibleConfig,
  demoInstructions: DemoInstructions,
  message: string,
  turnCounter: number,
): Promise<{
  dispatch: RuntimeDispatch;
  transcript: TranscriptEntry[];
  output: string;
  nextTurnCounter: number;
}> {
  if (codexConfig.model.trim().length === 0) {
    throw new Error("Select a model before sending a message.");
  }

  await ensureThread(runtime);
  const turnId = `${TURN_PREFIX}-${turnCounter}`;
  const dispatch = normalizeHostValue(
    await runtime.runTurn({
      threadId: THREAD_ID,
      turnId,
      input: [
        {
          type: "text",
          text: message,
        },
      ],
      modelPayload: {
        mode: "chat",
        model: codexConfig.model.trim(),
        authState,
        account,
        baseInstructions: demoInstructions.baseInstructions,
        userMessage: message,
      },
    }),
  ) as RuntimeDispatch;

  assertRuntimeDispatch(dispatch);

  const output = dispatch.events
    .filter((event) => event !== null && typeof event === "object" && event.event === "modelDelta")
    .map((event) => {
      const payload = event.payload as { payload: { outputTextDelta: string } };
      return payload.payload.outputTextDelta;
    })
    .join("");

  return {
    dispatch,
    transcript: snapshotToTranscript(dispatch.value),
    output,
    nextTurnCounter: turnCounter + 1,
  };
}

export async function resetThread(): Promise<void> {
  await deleteStoredSession(THREAD_ID);
}

export async function loadWorkspaceDebugSnapshot(): Promise<WorkspaceDebugFile[]> {
  const workspace = await loadStoredWorkspaceSnapshot();
  return workspace.files.map((file) => ({
    path: file.path,
    content: file.content,
    bytes: new TextEncoder().encode(file.content).length,
    preview: previewWorkspaceContent(file.content),
  }));
}

export async function resetWorkspace(): Promise<void> {
  await saveStoredWorkspaceSnapshot({
    rootPath: WORKSPACE_ROOT,
    files: [],
  });
}

export function normalizeHostValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return normalizeHostValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(normalizeHostValue);
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, nested]) => [key, normalizeHostValue(nested)]),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeHostValue(nested)]),
    );
  }
  return value;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    const data = "data" in error && error.data != null ? ` ${JSON.stringify(error.data)}` : "";
    return `${code}${error.message}${data}`;
  }
  if (error !== null && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return String(error);
}

async function loadBuildManifest(
  path: string = BUILD_MANIFEST_PATH,
  label: string = "pkg",
): Promise<{ buildId: string; entry: string; wasm: string }> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} manifest was not found (${response.status})`);
  }
  const manifest = (await response.json()) as Record<string, unknown>;
  if (
    typeof manifest.buildId !== "string" ||
    typeof manifest.entry !== "string" ||
    typeof manifest.wasm !== "string"
  ) {
    throw new Error(`${label} manifest is invalid`);
  }
  return {
    buildId: manifest.buildId,
    entry: manifest.entry,
    wasm: manifest.wasm,
  };
}

async function ensureThread(runtime: BrowserRuntime): Promise<void> {
  const existing = await runtime
    .resumeThread({
      threadId: THREAD_ID,
    })
    .then(normalizeHostValue)
    .catch(() => null);
  if (existing !== null) {
    return;
  }

  await runtime.startThread({
    threadId: THREAD_ID,
    metadata: {
      workspaceRoot: "/browser-chat-demo",
      demo: true,
    },
  });
}

function assertRuntimeDispatch(dispatch: RuntimeDispatch): void {
  if (dispatch === null || typeof dispatch !== "object" || !Array.isArray(dispatch.events)) {
    throw new Error("runtime.runTurn() returned an invalid dispatch payload");
  }

  dispatch.events
    .filter((event) => event !== null && typeof event === "object" && event.event === "modelDelta")
    .forEach((event) => {
      if (
        event.payload === null ||
        typeof event.payload !== "object" ||
        !("payload" in event.payload) ||
        event.payload.payload === null ||
        typeof event.payload.payload !== "object" ||
        !("outputTextDelta" in event.payload.payload) ||
        typeof event.payload.payload.outputTextDelta !== "string"
      ) {
        throw new Error(
          "runtime.runTurn() returned a modelDelta event without payload.payload.outputTextDelta",
        );
      }
    });
}

function snapshotToTranscript(snapshot: SessionSnapshot): TranscriptEntry[] {
  const transcript: TranscriptEntry[] = [];
  let pendingAssistant = "";

  for (const item of snapshot.items) {
    if (item === null || typeof item !== "object" || !("type" in item)) {
      continue;
    }
    if (item.type === "userInput" && Array.isArray(item.input)) {
      const text = item.input
        .filter((entry: unknown) => entry !== null && typeof entry === "object" && entry.type === "text")
        .map((entry: any) => entry.text ?? "")
        .join("\n");
      transcript.push({ role: "user", text });
      continue;
    }
    if (
      item.type === "modelDelta" &&
      "payload" in item &&
      item.payload !== null &&
      typeof item.payload === "object" &&
      "outputTextDelta" in item.payload &&
      typeof item.payload.outputTextDelta === "string"
    ) {
      pendingAssistant += item.payload.outputTextDelta;
      continue;
    }
    if (
      item.type === "modelOutputItem" &&
      "item" in item &&
      item.item !== null &&
      typeof item.item === "object"
    ) {
      const assistantText = assistantTextFromResponseItem(item.item as Record<string, unknown>);
      if (assistantText !== null) {
        if (pendingAssistant.length > 0) {
          if (pendingAssistant === assistantText) {
            transcript.push({ role: "assistant", text: assistantText });
            pendingAssistant = "";
            continue;
          }
          transcript.push({ role: "assistant", text: pendingAssistant });
          pendingAssistant = "";
        }
        transcript.push({ role: "assistant", text: assistantText });
      }
      continue;
    }
    if (item.type === "modelCompleted" && pendingAssistant.length > 0) {
      transcript.push({ role: "assistant", text: pendingAssistant });
      pendingAssistant = "";
    }
  }

  if (pendingAssistant.length > 0) {
    transcript.push({ role: "assistant", text: pendingAssistant });
  }

  return transcript;
}

function assistantTextFromResponseItem(item: Record<string, unknown>): string | null {
  if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) {
    return null;
  }
  const text = item.content
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === "object" && entry.type === "output_text",
    )
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .join("");
  return text.trim().length === 0 ? null : text;
}

type WorkspaceFileRecord = {
  path: string;
  content: string;
};

type WorkspaceSnapshot = {
  rootPath: string;
  files: WorkspaceFileRecord[];
};

async function loadStoredWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (raw === null) {
    return {
      rootPath: WORKSPACE_ROOT,
      files: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    return {
      rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath : WORKSPACE_ROOT,
      files: Array.isArray(parsed.files)
        ? parsed.files
            .filter(
              (file): file is WorkspaceFileRecord =>
                file !== null &&
                typeof file === "object" &&
                typeof file.path === "string" &&
                typeof file.content === "string",
            )
            .map((file) => ({
              path: normalizeWorkspaceFilePath(file.path),
              content: file.content,
            }))
        : [],
    };
  } catch {
    return {
      rootPath: WORKSPACE_ROOT,
      files: [],
    };
  }
}

async function saveStoredWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  window.localStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      rootPath: WORKSPACE_ROOT,
      files: snapshot.files
        .map((file) => ({
          path: normalizeWorkspaceFilePath(file.path),
          content: file.content,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
}

function previewWorkspaceContent(content: string, maxLength: number = 240): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength)}...`;
}

function debugWorkspaceSnapshot(label: string, workspace: WorkspaceSnapshot, path?: string): void {
  console.info(`[browser-chat-demo] ${label}`, {
    path: path ?? null,
    fileCount: workspace.files.length,
    files: workspace.files.map((file) => ({
      path: file.path,
      bytes: new TextEncoder().encode(file.content).length,
      preview: previewWorkspaceContent(file.content),
    })),
  });
}

function normalizeWorkspaceFilePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return WORKSPACE_ROOT;
  }
  if (trimmed === WORKSPACE_ROOT.replace(/^\/+/, "")) {
    return WORKSPACE_ROOT;
  }
  if (trimmed.startsWith(`${WORKSPACE_ROOT.replace(/^\/+/, "")}/`)) {
    return `/${trimmed}`;
  }
  return `${WORKSPACE_ROOT}/${trimmed}`;
}

function normalizeWorkspaceDirectoryPath(path: string): string {
  return normalizeWorkspaceFilePath(path).replace(/\/+$/, "");
}

function upsertWorkspaceFile(
  files: WorkspaceFileRecord[],
  nextFile: WorkspaceFileRecord,
): WorkspaceFileRecord[] {
  const nextFiles = files.filter((file) => file.path !== nextFile.path);
  nextFiles.push({
    path: normalizeWorkspaceFilePath(nextFile.path),
    content: nextFile.content,
  });
  nextFiles.sort((left, right) => left.path.localeCompare(right.path));
  return nextFiles;
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return `/${normalized.slice(0, lastSlash)}`;
}

type WorkspacePatchHunk = {
  oldText: string;
  newText: string;
};

type WorkspacePatchOperation =
  | {
      type: "add";
      path: string;
      content: string;
    }
  | {
      type: "update";
      path: string;
      hunks: WorkspacePatchHunk[];
    }
  | {
      type: "delete";
      path: string;
    };

function parseWorkspacePatch(patch: string): WorkspacePatchOperation[] {
  if (!patch.includes("*** Begin Patch")) {
    const unified = parseUnifiedDiffPatch(patch);
    if (unified !== null) {
      return unified;
    }
  }

  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") {
    throw createHostError("invalidInput", "workspace patch parser expected `*** Begin Patch`");
  }

  const operations: WorkspacePatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return operations;
    }
    if (line.startsWith("*** Add File: ")) {
      const path = normalizeWorkspaceFilePath(line.slice("*** Add File: ".length).trim());
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        const nextLine = lines[index];
        if (!nextLine.startsWith("+")) {
          throw createHostError("invalidInput", "workspace patch parser expected added lines for `*** Add File:`");
        }
        contentLines.push(nextLine.slice(1));
        index += 1;
      }
      operations.push({
        type: "add",
        path,
        content: contentLines.join("\n"),
      });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: normalizeWorkspaceFilePath(line.slice("*** Delete File: ".length).trim()),
      });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const path = normalizeWorkspaceFilePath(line.slice("*** Update File: ".length).trim());
      index += 1;
      if (index < lines.length && lines[index].startsWith("*** Move to: ")) {
        index += 1;
      }

      const hunks: WorkspacePatchHunk[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        const header = lines[index];
        if (!header.startsWith("@@")) {
          throw createHostError("invalidInput", "workspace patch parser expected `@@` hunk header");
        }
        index += 1;

        const oldLines: string[] = [];
        const newLines: string[] = [];
        while (
          index < lines.length &&
          !lines[index].startsWith("@@") &&
          !lines[index].startsWith("*** ")
        ) {
          const hunkLine = lines[index];
          if (hunkLine === "\\ No newline at end of file") {
            index += 1;
            continue;
          }
          if (hunkLine.startsWith("-")) {
            oldLines.push(hunkLine.slice(1));
            index += 1;
            continue;
          }
          if (hunkLine.startsWith("+")) {
            newLines.push(hunkLine.slice(1));
            index += 1;
            continue;
          }
          if (hunkLine.startsWith(" ")) {
            oldLines.push(hunkLine.slice(1));
            newLines.push(hunkLine.slice(1));
            index += 1;
            continue;
          }
          throw createHostError("invalidInput", "workspace patch parser found an unsupported hunk line");
        }

        hunks.push({
          oldText: oldLines.join("\n"),
          newText: newLines.join("\n"),
        });

        if (index < lines.length && lines[index] === "*** End of File") {
          index += 1;
          break;
        }
      }

      if (hunks.length === 0) {
        throw createHostError("invalidInput", "workspace patch parser expected at least one hunk");
      }

      operations.push({
        type: "update",
        path,
        hunks,
      });
      continue;
    }

    throw createHostError("invalidInput", `workspace patch parser found an unsupported directive: ${line}`);
  }

  throw createHostError("invalidInput", "workspace patch parser expected `*** End Patch`");
}

function parseUnifiedDiffPatch(patch: string): WorkspacePatchOperation[] | null {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const operations: WorkspacePatchOperation[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }

    const oldFileLine = lines[index];
    const newFileLine = lines[index + 1];
    if (newFileLine === undefined || !newFileLine.startsWith("+++ ")) {
      throw createHostError("invalidInput", "workspace patch parser expected `+++` after `---`");
    }

    const oldPath = normalizeUnifiedDiffPath(oldFileLine.slice(4).trim());
    const newPath = normalizeUnifiedDiffPath(newFileLine.slice(4).trim());
    index += 2;

    const hunks: WorkspacePatchHunk[] = [];
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      if (!lines[index].startsWith("@@")) {
        index += 1;
        continue;
      }

      index += 1;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      while (
        index < lines.length &&
        !lines[index].startsWith("@@") &&
        !lines[index].startsWith("--- ")
      ) {
        const line = lines[index];
        if (line === "\\ No newline at end of file") {
          index += 1;
          continue;
        }
        if (line.startsWith("-")) {
          oldLines.push(line.slice(1));
          index += 1;
          continue;
        }
        if (line.startsWith("+")) {
          newLines.push(line.slice(1));
          index += 1;
          continue;
        }
        if (line.startsWith(" ")) {
          oldLines.push(line.slice(1));
          newLines.push(line.slice(1));
          index += 1;
          continue;
        }
        break;
      }

      hunks.push({
        oldText: oldLines.join("\n"),
        newText: newLines.join("\n"),
      });
    }

    if (newPath === null) {
      if (oldPath === null) {
        throw createHostError("invalidInput", "workspace patch parser could not resolve unified diff path");
      }
      operations.push({ type: "delete", path: oldPath });
      continue;
    }

    if (oldPath === null) {
      operations.push({
        type: "add",
        path: newPath,
        content: hunks.map((hunk) => hunk.newText).join(""),
      });
      continue;
    }

    operations.push({
      type: "update",
      path: newPath,
      hunks,
    });
  }

  if (operations.length === 0) {
    return null;
  }
  return operations;
}

function normalizeUnifiedDiffPath(path: string): string | null {
  const trimmed = path.replace(/^([ab]\/)/, "").trim();
  if (trimmed === "/dev/null") {
    return null;
  }
  return normalizeWorkspaceFilePath(trimmed);
}

function applyUpdateHunksToContent(content: string, hunks: WorkspacePatchHunk[]): string {
  let cursor = 0;
  let nextContent = "";

  for (const hunk of hunks) {
    if (hunk.oldText.length === 0) {
      nextContent += content.slice(cursor, cursor) + hunk.newText;
      continue;
    }

    const matchIndex = content.indexOf(hunk.oldText, cursor);
    if (matchIndex === -1) {
      throw createHostError("conflict", "patch target block was not found in workspace file");
    }

    nextContent += content.slice(cursor, matchIndex);
    nextContent += hunk.newText;
    cursor = matchIndex + hunk.oldText.length;
  }

  nextContent += content.slice(cursor);
  return nextContent;
}

function createBrowserRuntimeHost(): BrowserRuntimeHost {
  return {
    async loadSession(threadId) {
      return loadStoredSession(threadId);
    },

    async loadInstructions(threadId) {
      return loadStoredInstructionSnapshot(threadId);
    },

    async saveSession(snapshot) {
      await saveStoredSession(snapshot);
    },

    async loadAuthState() {
      return loadStoredAuthState();
    },

    async saveAuthState(authState) {
      await saveStoredAuthState(authState);
    },

    async clearAuthState() {
      await clearStoredAuthState();
    },

    async readAccount() {
      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const authState = await loadStoredAuthState();
      if (authState === null) {
        return {
          account: null,
          requiresOpenaiAuth: provider.providerKind === "openai",
        };
      }
      return {
        account: {
          email: null,
          planType: authState.chatgptPlanType,
          chatgptAccountId: authState.chatgptAccountId,
          authMode: authState.authMode,
        },
        requiresOpenaiAuth: provider.providerKind === "openai" && authState.openaiApiKey === null,
      };
    },

    async listModels() {
      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const apiKey = activeProviderApiKey(codexConfig);
      if (apiKey.length === 0) {
        return {
          data: [],
          nextCursor: null,
        };
      }
      if (provider.providerKind === "xrouter_browser") {
        return discoverRouterModels(codexConfig);
      }
      return discoverProviderModels(codexConfig);
    },

    async refreshAuth(context) {
      const authState = await loadStoredAuthState();
      if (authState === null || authState.authMode !== "chatgptAuthTokens" || authState.chatgptAccountId === null) {
        throw createHostError("unavailable", "auth refresh is only available for external ChatGPT auth");
      }
      return {
        accessToken: `${authState.accessToken ?? "demo-access-token"}:refreshed`,
        chatgptAccountId: authState.chatgptAccountId,
        chatgptPlanType: authState.chatgptPlanType,
        context,
      };
    },

    async readFile(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (typeof normalizedRequest.path !== "string") {
        throw createHostError("invalidInput", "readFile expected path");
      }
      const workspace = await loadStoredWorkspaceSnapshot();
      const path = normalizeWorkspaceFilePath(normalizedRequest.path);
      const file = workspace.files.find((entry) => entry.path === path);
      if (file === undefined) {
        throw createHostError("notFound", `workspace file was not found: ${path}`);
      }
      console.info("[browser-chat-demo] workspace.readFile", {
        path,
        bytes: new TextEncoder().encode(file.content).length,
        preview: previewWorkspaceContent(file.content),
      });
      return {
        path,
        content: file.content,
      };
    },

    async listDir(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (typeof normalizedRequest.path !== "string") {
        throw createHostError("invalidInput", "listDir expected path");
      }
      const recursive = normalizedRequest.recursive === true;
      const workspace = await loadStoredWorkspaceSnapshot();
      const path = normalizeWorkspaceDirectoryPath(normalizedRequest.path);
      return {
        entries: workspace.files
          .filter((file) =>
            recursive
              ? file.path === path || file.path.startsWith(`${path}/`)
              : parentDirectory(file.path) === path,
          )
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((file) => ({
            path: file.path,
            isDir: false,
            sizeBytes: new TextEncoder().encode(file.content).length,
          })),
      };
    },

    async search(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (
        typeof normalizedRequest.path !== "string" ||
        typeof normalizedRequest.query !== "string" ||
        typeof normalizedRequest.caseSensitive !== "boolean"
      ) {
        throw createHostError("invalidInput", "search expected path, query and caseSensitive");
      }
      const workspace = await loadStoredWorkspaceSnapshot();
      const path = normalizeWorkspaceDirectoryPath(normalizedRequest.path);
      const query = normalizedRequest.caseSensitive
        ? normalizedRequest.query
        : normalizedRequest.query.toLocaleLowerCase();
      return {
        matches: workspace.files
          .filter((file) => file.path === path || file.path.startsWith(`${path}/`))
          .flatMap((file) =>
            file.content.split("\n").flatMap((line, index) => {
              const candidate = normalizedRequest.caseSensitive
                ? line
                : line.toLocaleLowerCase();
              if (!candidate.includes(query)) {
                return [];
              }
              return [
                {
                  path: file.path,
                  lineNumber: index + 1,
                  line,
                },
              ];
            }),
          ),
      };
    },

    async writeFile(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (
        typeof normalizedRequest.path !== "string" ||
        typeof normalizedRequest.content !== "string"
      ) {
        throw createHostError("invalidInput", "writeFile expected path and content");
      }
      const workspace = await loadStoredWorkspaceSnapshot();
      const path = normalizeWorkspaceFilePath(normalizedRequest.path);
      const content = normalizedRequest.content;
      workspace.files = upsertWorkspaceFile(workspace.files, { path, content });
      await saveStoredWorkspaceSnapshot(workspace);
      return {
        path,
        bytesWritten: new TextEncoder().encode(content).length,
      };
    },

    async applyPatch(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (typeof normalizedRequest.patch !== "string") {
        throw createHostError("invalidInput", "applyPatch expected patch");
      }
      const workspace = await loadStoredWorkspaceSnapshot();
      const operations = parseWorkspacePatch(normalizedRequest.patch);
      const filesChanged: string[] = [];

      for (const operation of operations) {
        if (operation.type === "add") {
          const existingFile = workspace.files.find((file) => file.path === operation.path);
          if (existingFile !== undefined) {
            throw createHostError("conflict", `workspace file already exists: ${operation.path}`);
          }
          workspace.files = upsertWorkspaceFile(workspace.files, {
            path: operation.path,
            content: operation.content,
          });
          filesChanged.push(operation.path);
          continue;
        }

        if (operation.type === "delete") {
          const nextFiles = workspace.files.filter((file) => file.path !== operation.path);
          if (nextFiles.length === workspace.files.length) {
            throw createHostError("notFound", `workspace file was not found: ${operation.path}`);
          }
          workspace.files = nextFiles;
          filesChanged.push(operation.path);
          continue;
        }

        const originalFile = workspace.files.find((file) => file.path === operation.path);
        const currentContent = originalFile?.content ?? "";
        const nextContent = applyUpdateHunksToContent(currentContent, operation.hunks);
        if (originalFile === undefined && currentContent.length !== 0) {
          throw createHostError("notFound", `workspace file was not found: ${operation.path}`);
        }
        workspace.files = upsertWorkspaceFile(workspace.files, {
          path: operation.path,
          content: nextContent,
        });
        filesChanged.push(operation.path);
      }

      await saveStoredWorkspaceSnapshot(workspace);
      debugWorkspaceSnapshot("workspace.afterApplyPatch", workspace);
      return {
        filesChanged,
      };
    },

    async updatePlan() {},

    async requestUserInput(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      const questions = Array.isArray(normalizedRequest.questions)
        ? (normalizedRequest.questions as Array<Record<string, unknown>>)
        : null;
      if (questions === null) {
        throw createHostError("invalidInput", "requestUserInput expected questions");
      }
      const answers = questions.map((question) => {
        const promptText =
          typeof question.question === "string" ? question.question : "Provide input";
        const id = typeof question.id === "string" ? question.id : "answer";
        const answer = window.prompt(promptText) ?? "";
        return {
          id,
          value: answer,
        };
      });
      return { answers };
    },

    async startModelTurn(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      const requestId =
        typeof normalizedRequest.requestId === "string" ? normalizedRequest.requestId : null;
      const payload =
        normalizedRequest.payload !== null && typeof normalizedRequest.payload === "object"
          ? (normalizedRequest.payload as Record<string, unknown>)
          : null;

      if (requestId === null) {
        throw createHostError("invalidInput", "startModelTurn expected requestId");
      }
      if (payload === null) {
        throw createHostError("invalidInput", "startModelTurn expected payload object");
      }

      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const apiKey = activeProviderApiKey(codexConfig);
      if (apiKey.length === 0) {
        throw createHostError(
          "permissionDenied",
          "browser chat demo requires provider config before starting a model turn",
        );
      }

      const selectedModel = typeof payload.model === "string" ? payload.model : "unknown-model";
      const baseInstructions =
        typeof payload.baseInstructions === "string" ? payload.baseInstructions.trim() : "";
      const userMessage = typeof payload.userMessage === "string" ? payload.userMessage : "";
      const responseInputItems = Array.isArray(payload.responseInputItems)
        ? (payload.responseInputItems as JsonValue[])
        : null;
      const toolSpecs = Array.isArray(payload.tools) ? (payload.tools as HostToolSpec[]) : [];
      const instructionMessages = extractContextualInstructionMessages(payload);
      const instructionsText = [baseInstructions, ...instructionMessages].filter(Boolean).join("\n\n");
      console.info("[browser-chat-demo] host.startModelTurn", {
        requestId,
        model: selectedModel,
        providerKind: provider.providerKind,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        userMessage,
        responseInputItemCount: responseInputItems?.length ?? 0,
        hasBaseInstructions: baseInstructions.length > 0,
        instructionMessageCount: instructionMessages.length,
        toolCount: toolSpecs.length,
        toolNames: toolSpecs.map((tool) => tool.name),
      });
      emitRuntimeActivity({
        type: "turnStart",
        requestId,
        model: selectedModel,
      });
      console.info("[browser-chat-demo] host.startModelTurn:response_input_items", {
        requestId,
        responseInputItems,
      });
      if (responseInputItems !== null) {
        for (const item of responseInputItems) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) {
            continue;
          }
          const record = item as Record<string, unknown>;
          if (record.type === "function_call_output") {
            console.info("[browser-chat-demo] host.startModelTurn:tool_output_item", {
              requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              output: record.output ?? null,
            });
            emitRuntimeActivity({
              type: "toolOutput",
              requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              output: (record.output as JsonValue | undefined) ?? null,
            });
          }
        }
      }

      if (provider.providerKind === "xrouter_browser") {
        return runXrouterTurn({
          requestId,
          codexConfig,
          model: selectedModel,
          instructionsText,
          userMessage,
          responseInputItems,
          toolSpecs,
        });
      }

      return runResponsesApiTurn({
        requestId,
        baseUrl: provider.baseUrl,
        model: selectedModel,
        apiKey,
        instructionsText,
        userMessage,
        responseInputItems,
        toolSpecs,
      });
    },

    async cancelModelTurn(request) {
      const requestId = typeof request === "string" ? request : request?.toString();
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw createHostError("invalidInput", "cancelModelTurn expected requestId");
      }
      console.info("[browser-chat-demo] host.cancelModelTurn", {
        requestId,
      });
      for (const [activeRequestId, activeRequest] of activeModelRequests.entries()) {
        if (activeRequestId === requestId || activeRequestId.startsWith(`${requestId}:`)) {
          console.info("[browser-chat-demo] host.cancelModelTurn:cancel", {
            requestId,
            activeRequestId,
            kind: activeRequest.kind,
          });
          activeRequest.cancel();
        }
      }
    },
  };
}

function createHostError(code: string, message: string, data: JsonValue | null = null): JsonValue {
  return {
    code,
    message,
    retryable: false,
    data,
  };
}

async function createOpenAiHostError(response: Response, fallbackMessage: string): Promise<JsonValue> {
  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
        type?: string;
      };
    };
    if (typeof payload.error?.message === "string") {
      detail = payload.error.message;
    }
    return createHostError(payload.error?.code ?? "openaiError", detail, {
      status: response.status,
      type: payload.error?.type ?? null,
    });
  } catch {
    const body = await response.text().catch(() => "");
    return createHostError("openaiError", detail, {
      status: response.status,
      body,
    });
  }
}

async function runResponsesApiTurn(params: {
  requestId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  instructionsText: string;
  userMessage: string;
  responseInputItems: JsonValue[] | null;
  toolSpecs: HostToolSpec[];
}): Promise<JsonValue> {
  const abortController = new AbortController();
  let cancelled = false;
  registerActiveModelRequest({
    kind: "responses",
    requestId: params.requestId,
    cancel: () => {
      cancelled = true;
      abortController.abort();
    },
    isCancelled: () => cancelled,
  });
  const tools = toResponsesApiTools(params.toolSpecs);
  console.info("[browser-chat-demo] responses.run:start", {
    requestId: params.requestId,
    baseUrl: params.baseUrl,
    model: params.model,
    toolCount: params.toolSpecs.length,
    toolNames: params.toolSpecs.map((tool) => tool.name),
  });
  const response = await sendJsonRequestWithFallback({
    urls: candidateApiUrls(params.baseUrl, "responses"),
    method: "POST",
    apiKey: params.apiKey,
    signal: abortController.signal,
    body: {
      model: params.model,
      instructions: params.instructionsText.length === 0 ? undefined : params.instructionsText,
      input: params.responseInputItems ?? params.userMessage,
      tools: tools.length === 0 ? undefined : tools,
      stream: true,
    },
    fallbackMessage: "responses request failed",
  }).catch((error) => {
    unregisterActiveModelRequest(params.requestId);
    if (cancelled || isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  });
  if (response.body === null) {
    unregisterActiveModelRequest(params.requestId);
    throw createHostError("unavailable", "responses request did not return a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const modelEvents: JsonValue[] = [
    {
      type: "started",
      requestId: params.requestId,
    },
  ];

  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read().catch((error) => {
        if (cancelled || isAbortError(error)) {
          throw createHostError("cancelled", "model turn cancelled");
        }
        throw error;
      });
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const data = readSseData(segment);
        if (data === null || data === "[DONE]") {
          continue;
        }

        let eventPayload: Record<string, unknown>;
        try {
          eventPayload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const outputTextDelta = extractOutputTextDelta(eventPayload);
        if (outputTextDelta !== null) {
          emitRuntimeActivity({
            type: "delta",
            requestId: params.requestId,
            text: outputTextDelta,
          });
          modelEvents.push({
            type: "delta",
            requestId: params.requestId,
            payload: {
              outputTextDelta,
            },
          });
        }

        const outputItem = extractOutputItemDone(eventPayload);
        if (outputItem !== null) {
          modelEvents.push({
            type: "outputItemDone",
            requestId: params.requestId,
            item: outputItem,
          });
        }

        if (eventPayload.type === "error") {
          emitRuntimeActivity({
            type: "error",
            requestId: params.requestId,
            message: extractOpenAiEventMessage(eventPayload),
          });
          throw createHostError("openaiError", extractOpenAiEventMessage(eventPayload));
        }
      }

      if (done) {
        break;
      }
    }
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  modelEvents.push({
    type: "completed",
    requestId: params.requestId,
  });
  emitRuntimeActivity({
    type: "completed",
    requestId: params.requestId,
    finishReason: null,
  });
  console.info("[browser-chat-demo] responses.run:done", {
    requestId: params.requestId,
    events: modelEvents.length,
  });
  return modelEvents;
}

function toResponsesApiTools(toolSpecs: HostToolSpec[]): JsonValue[] {
  return toolSpecs.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function readSseData(segment: string): string | null {
  const dataLines = segment
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}

function extractOutputTextDelta(eventPayload: Record<string, unknown>): string | null {
  if (eventPayload.type !== "response.output_text.delta") {
    return null;
  }
  return typeof eventPayload.delta === "string" ? eventPayload.delta : null;
}

function extractOutputItemDone(eventPayload: Record<string, unknown>): JsonValue | null {
  if (eventPayload.type !== "response.output_item.done") {
    return null;
  }
  if ("item" in eventPayload && eventPayload.item !== null && typeof eventPayload.item === "object") {
    return eventPayload.item as JsonValue;
  }
  return null;
}

function extractOpenAiEventMessage(eventPayload: Record<string, unknown>): string {
  const error =
    "error" in eventPayload && eventPayload.error !== null && typeof eventPayload.error === "object"
      ? (eventPayload.error as Record<string, unknown>)
      : null;
  if (error !== null && typeof error.message === "string") {
    return error.message;
  }
  return "OpenAI stream returned an error event";
}

function modelIdToDisplayName(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

function normalizeCodexConfig(config: CodexCompatibleConfig): CodexCompatibleConfig {
  const transportMode = detectTransportMode(config);
  return materializeCodexConfig({
    transportMode,
    model: config.model.trim(),
    modelReasoningEffort: config.modelReasoningEffort,
    personality: config.personality,
    displayName: getActiveProvider(config).name,
    baseUrl: getActiveProvider(config).baseUrl,
    apiKey: activeProviderApiKey(config),
    xrouterProvider: getActiveProvider(config).metadata?.xrouterProvider ?? "deepseek",
  });
}

function materializeCodexConfig(params: {
  transportMode: DemoTransportMode;
  model: string;
  modelReasoningEffort: string | null;
  personality: string | null;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  xrouterProvider: XrouterProvider;
}): CodexCompatibleConfig {
  const modelProvider =
    params.transportMode === "openai"
      ? OPENAI_PROVIDER_ID
      : params.transportMode === "xrouter-browser"
        ? XROUTER_BROWSER_PROVIDER_ID
        : OPENAI_COMPATIBLE_PROVIDER_ID;
  const provider = createProviderConfig(
    params.transportMode,
    params.displayName,
    params.baseUrl,
    params.xrouterProvider,
  );

  return {
    model: params.model,
    modelProvider,
    modelReasoningEffort: params.modelReasoningEffort,
    personality: params.personality,
    modelProviders: {
      [modelProvider]: provider,
    },
    env: {
      [provider.envKey]: params.apiKey.trim(),
    },
  };
}

function createProviderConfig(
  transportMode: DemoTransportMode,
  displayName: string,
  baseUrl: string,
  xrouterProvider: XrouterProvider,
): CodexModelProviderConfig {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  switch (transportMode) {
    case "openai":
      return {
        name: displayName.trim() || "OpenAI",
        baseUrl: normalizedBaseUrl || OPENAI_API_BASE_URL,
        envKey: OPENAI_ENV_KEY,
        providerKind: "openai",
        wireApi: "responses",
        metadata: null,
      };
    case "xrouter-browser":
      return {
        name: displayName.trim() || `${toProviderLabel(xrouterProvider)} via XRouter Browser`,
        baseUrl: normalizedBaseUrl || defaultXrouterProviderBaseUrl(xrouterProvider),
        envKey: XROUTER_ENV_KEY,
        providerKind: "xrouter_browser",
        wireApi: "responses",
        metadata: {
          xrouterProvider,
        },
      };
    case "openai-compatible":
      return {
        name: displayName.trim() || "OpenAI-Compatible Server",
        baseUrl: normalizedBaseUrl,
        envKey: OPENAI_COMPATIBLE_ENV_KEY,
        providerKind: "openai_compatible",
        wireApi: "responses",
        metadata: null,
      };
  }
}

function getActiveProvider(config: CodexCompatibleConfig): CodexModelProviderConfig {
  return config.modelProviders[config.modelProvider] ?? DEFAULT_CODEX_CONFIG.modelProviders[OPENAI_PROVIDER_ID];
}

function activeProviderApiKey(config: CodexCompatibleConfig): string {
  const provider = getActiveProvider(config);
  return (config.env[provider.envKey] ?? "").trim();
}

function detectTransportMode(config: CodexCompatibleConfig): DemoTransportMode {
  switch (getActiveProvider(config).providerKind) {
    case "openai":
      return "openai";
    case "xrouter_browser":
      return "xrouter-browser";
    case "openai_compatible":
      return "openai-compatible";
  }
}

async function discoverProviderModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  const response = await sendJsonRequestWithFallback({
    urls: candidateApiUrls(provider.baseUrl, "models"),
    method: "GET",
    apiKey: activeProviderApiKey(codexConfig),
    fallbackMessage: "failed to list models",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const normalized = normalizeDiscoveredModels(payload, provider.providerKind === "openai");

  return {
    data: normalized,
    nextCursor: null,
  };
}

async function discoverRouterModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  console.info("[browser-chat-demo] xrouter.discoverModels:start", {
    provider: provider.metadata?.xrouterProvider ?? "deepseek",
    baseUrl: provider.baseUrl,
    hasApiKey: activeProviderApiKey(codexConfig).length > 0,
  });
  const client = await createXrouterClient(codexConfig);
  console.info("[browser-chat-demo] xrouter.discoverModels:client-ready");
  const modelIds = normalizeHostValue(await client.fetchModelIds());
  console.info("[browser-chat-demo] xrouter.discoverModels:done", modelIds);
  if (!Array.isArray(modelIds)) {
    throw new Error("xrouter-browser returned an invalid model id list");
  }

  return {
    data: modelIds
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((id, index) => ({
        id,
        displayName: modelIdToDisplayName(id),
        description: `${provider.name}`,
        isDefault: index === 0,
        showInPicker: true,
        supportsApi: true,
      })),
    nextCursor: null,
  };
}

async function runXrouterTurn(params: {
  requestId: string;
  codexConfig: CodexCompatibleConfig;
  model: string;
  instructionsText: string;
  userMessage: string;
  responseInputItems: JsonValue[] | null;
  toolSpecs: HostToolSpec[];
}): Promise<JsonValue> {
  console.info("[browser-chat-demo] xrouter.run:start", {
    requestId: params.requestId,
    model: params.model,
    toolCount: params.toolSpecs.length,
    toolNames: params.toolSpecs.map((tool) => tool.name),
  });
  const client = await createXrouterClient(params.codexConfig);
  let cancelled = false;
  registerActiveModelRequest({
    kind: "xrouter",
    requestId: params.requestId,
    cancel: () => {
      cancelled = true;
      client.cancel(params.requestId);
    },
    isCancelled: () => cancelled,
  });
  const modelEvents: JsonValue[] = [
    {
      type: "started",
      requestId: params.requestId,
    },
  ];
  let streamError: JsonValue | null = null;
  const responsesRequest = {
    model: params.model,
    input: buildXrouterResponsesInput(
      params.instructionsText,
      params.userMessage,
      params.responseInputItems,
    ),
    stream: true,
    tools: params.toolSpecs.length === 0 ? undefined : toResponsesApiTools(params.toolSpecs),
    tool_choice: params.toolSpecs.length === 0 ? undefined : "auto",
  };
  console.info("[browser-chat-demo] xrouter.run:request", {
    requestId: params.requestId,
    request: responsesRequest,
  });

  try {
    await client.runResponsesStream(
      params.requestId,
      responsesRequest,
      (event: unknown) => {
        if (cancelled) {
          return;
        }
        const normalizedEvent = normalizeHostValue(event);
        const payload =
          normalizedEvent !== null && typeof normalizedEvent === "object"
            ? (normalizedEvent as Record<string, unknown>)
            : null;
        if (payload === null || typeof payload.type !== "string") {
          return;
        }

        if (payload.type === "output_text_delta" && typeof payload.delta === "string") {
          emitRuntimeActivity({
            type: "delta",
            requestId: params.requestId,
            text: payload.delta,
          });
          modelEvents.push({
            type: "delta",
            requestId: params.requestId,
            payload: {
              outputTextDelta: payload.delta,
            },
          });
          return;
        }

      if (payload.type === "response_completed") {
        const outputItems = Array.isArray(payload.output) ? (payload.output as JsonValue[]) : [];
        const normalizedOutputItems = outputItems
          .map((item) => mapXrouterOutputItemToCodexResponseItem(item))
          .filter((item): item is JsonValue => item !== null);
        console.info("[browser-chat-demo] xrouter.run:response_completed", {
          requestId: params.requestId,
          finishReason: payload.finish_reason,
          outputItemTypes: outputItems
            .map((item) =>
              item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.type === "string"
                ? item.type
                : "unknown",
            ),
          normalizedOutputItemTypes: normalizedOutputItems
            .map((item) =>
              item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.type === "string"
                ? item.type
                : "unknown",
            ),
          normalizedOutputItems,
          output: outputItems,
        });
        for (const item of normalizedOutputItems) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) {
            continue;
          }
          const record = item as Record<string, unknown>;
          if (record.type === "function_call") {
            console.info("[browser-chat-demo] xrouter.run:tool_call", {
              requestId: params.requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              toolName: typeof record.name === "string" ? record.name : null,
              arguments: typeof record.arguments === "string" ? record.arguments : record.arguments ?? null,
            });
            emitRuntimeActivity({
              type: "toolCall",
              requestId: params.requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              toolName: typeof record.name === "string" ? record.name : null,
              arguments:
                (typeof record.arguments === "string"
                  ? record.arguments
                  : (record.arguments as JsonValue | undefined)) ?? null,
            });
            continue;
          }
          if (record.type === "message") {
            console.info("[browser-chat-demo] xrouter.run:assistant_message_item", {
              requestId: params.requestId,
              role: typeof record.role === "string" ? record.role : null,
              content: record.content ?? null,
            });
            emitRuntimeActivity({
              type: "assistantMessage",
              requestId: params.requestId,
              content: (record.content as JsonValue | undefined) ?? null,
            });
          }
        }
        for (const item of normalizedOutputItems) {
          modelEvents.push({
            type: "outputItemDone",
            requestId: params.requestId,
            item,
          });
        }
        if (!modelEvents.some((event) => isOutputItemDoneEvent(event, params.requestId))) {
          modelEvents.push({
            type: "outputItemDone",
            requestId: params.requestId,
            item: {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "",
                },
              ],
              end_turn: true,
            },
          });
        }
        console.info("[browser-chat-demo] xrouter.run:event", {
          requestId: params.requestId,
          type: payload.type,
        });
        emitRuntimeActivity({
          type: "completed",
          requestId: params.requestId,
          finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
        });
        modelEvents.push({
          type: "completed",
          requestId: params.requestId,
        });
        return;
      }

        if (payload.type === "response_error") {
          console.error("[browser-chat-demo] xrouter.run:event", {
            requestId: params.requestId,
            type: payload.type,
            message: payload.message,
          });
          emitRuntimeActivity({
            type: "error",
            requestId: params.requestId,
            message: typeof payload.message === "string" ? payload.message : "xrouter request failed",
          });
          streamError = createHostError(
            "unavailable",
            typeof payload.message === "string" ? payload.message : "xrouter request failed",
          );
        }
      },
    );
  } catch (error) {
    unregisterActiveModelRequest(params.requestId);
    if (cancelled || isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  if (streamError !== null) {
    throw streamError;
  }
  if (cancelled) {
    throw createHostError("cancelled", "model turn cancelled");
  }

  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    modelEvents.push({
      type: "completed",
      requestId: params.requestId,
    });
  }

  console.info("[browser-chat-demo] xrouter.run:done", {
    requestId: params.requestId,
    events: modelEvents.length,
  });
  return modelEvents;
}

function buildXrouterResponsesInput(
  instructionsText: string,
  userMessage: string,
  responseInputItems: JsonValue[] | null,
): JsonValue {
  if (responseInputItems === null) {
    return composeXrouterInput(instructionsText, userMessage);
  }

  const normalizedItems = responseInputItems
    .map((item) => mapCodexResponseInputItemToXrouterInputItem(item))
    .filter((item): item is JsonValue => item !== null);
  console.info("[browser-chat-demo] xrouter.run:normalized_input_items", {
    responseInputItems,
    normalizedItems,
  });

  if (instructionsText.trim().length === 0) {
    return normalizedItems;
  }

  return [
    {
      type: "message",
      role: "system",
      content: instructionsText,
    },
    ...normalizedItems,
  ];
}

function mapCodexResponseInputItemToXrouterInputItem(item: JsonValue): JsonValue | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  if (record.type === "message") {
    const role = typeof record.role === "string" ? record.role : "user";
    const text = extractMessageTextForXrouter(record);
    if (text === null) {
      return null;
    }
    return {
      type: "message",
      role,
      content: text,
    };
  }

  if (record.type === "function_call") {
    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.id === "string"
          ? record.id
          : null;
    if (callId === null || typeof record.name !== "string") {
      return null;
    }
    return {
      type: "function_call",
      call_id: callId,
      name: record.name,
      arguments:
        typeof record.arguments === "string"
          ? record.arguments
          : record.arguments !== undefined
            ? JSON.stringify(record.arguments)
            : "{}",
    };
  }

  if (record.type === "function_call_output") {
    const callId = typeof record.call_id === "string" ? record.call_id : null;
    if (callId === null) {
      return null;
    }
    const outputText = extractFunctionCallOutputText(record);
    if (outputText === null) {
      return null;
    }
    return {
      type: "function_call_output",
      call_id: callId,
      output: outputText,
    };
  }

  return null;
}

function extractMessageTextForXrouter(item: Record<string, unknown>): string | null {
  const content = Array.isArray(item.content) ? (item.content as JsonValue[]) : null;
  if (content === null) {
    return null;
  }

  const text = content
    .map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const part = entry as Record<string, unknown>;
      if (typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");

  return text.trim().length === 0 ? null : text;
}

function extractFunctionCallOutputText(item: Record<string, unknown>): string | null {
  if (!("output" in item)) {
    return null;
  }

  const raw = item.output;

  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return JSON.stringify(raw);
  }

  if (raw !== null && typeof raw === "object") {
    const output = raw as Record<string, unknown>;

    if (typeof output.output === "string") {
      return output.output;
    }

    if (typeof output.body === "string") {
      return output.body;
    }

    if ("body" in output && output.body !== undefined) {
      return JSON.stringify(output.body);
    }

    return JSON.stringify(output);
  }

  return raw === undefined ? null : JSON.stringify(raw);
}

function mapXrouterOutputItemToCodexResponseItem(item: JsonValue): JsonValue | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (record.type === "message") {
    const role = typeof record.role === "string" ? record.role : "assistant";
    const content = Array.isArray(record.content) ? (record.content as JsonValue[]) : [];
    return {
      type: "message",
      role,
      content,
      end_turn: true,
    };
  }
  if (
    record.type === "function_call" &&
    typeof record.name === "string"
  ) {
    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.id === "string"
          ? record.id
          : null;
    if (callId === null) {
      return null;
    }
    const argumentsText =
      typeof record.arguments === "string"
        ? record.arguments
        : record.arguments !== undefined
          ? JSON.stringify(record.arguments)
          : "{}";
    return {
      type: "function_call",
      id: typeof record.id === "string" ? record.id : undefined,
      call_id: callId,
      name: record.name,
      arguments: argumentsText,
    };
  }
  return null;
}

function isOutputItemDoneEvent(event: JsonValue, requestId: string): boolean {
  return (
    event !== null &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    event.type === "outputItemDone" &&
    event.requestId === requestId
  );
}

function stringifyResponseInputItems(items: JsonValue[]): string {
  return items
    .map((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        const assistantText = assistantTextFromResponseItem(item as Record<string, unknown>);
        if (assistantText !== null) {
          return assistantText;
        }
        if (
          item.type === "function_call_output" &&
          "output" in item &&
          item.output !== null &&
          typeof item.output === "object"
        ) {
          const output = item.output as Record<string, unknown>;
          if (typeof output.output === "string") {
            return output.output;
          }
          if (typeof output.body === "string") {
            return output.body;
          }
        }
      }
      return JSON.stringify(item);
    })
    .join("\n\n");
}

async function sendJsonRequestWithFallback(params: {
  urls: string[];
  method: "GET" | "POST";
  apiKey: string;
  signal?: AbortSignal;
  body?: Record<string, unknown>;
  fallbackMessage: string;
}): Promise<Response> {
  const uniqueUrls = [...new Set(params.urls)];
  let lastError: JsonValue | null = null;

  for (const url of uniqueUrls) {
    const response = await fetch(url, {
      method: params.method,
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        ...(params.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
    });

    if (response.ok) {
      return response;
    }

    lastError = await createOpenAiHostError(response, params.fallbackMessage);
    if (response.status !== 404) {
      throw lastError;
    }
  }

  throw lastError ?? createHostError("openaiError", params.fallbackMessage);
}

function registerActiveModelRequest(request: ActiveModelRequest) {
  activeModelRequests.set(request.requestId, request);
}

function unregisterActiveModelRequest(requestId: string) {
  activeModelRequests.delete(requestId);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function candidateApiUrls(baseUrl: string, resource: "models" | "responses"): string[] {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const urls = [`${normalizedBaseUrl}/${resource}`];
  if (!normalizedBaseUrl.endsWith("/v1") && !normalizedBaseUrl.endsWith("/api/v1")) {
    urls.push(`${normalizedBaseUrl}/v1/${resource}`);
  }
  return urls;
}

function extractContextualInstructionMessages(payload: Record<string, unknown>): string[] {
  const codexInstructions =
    payload.codexInstructions !== null && typeof payload.codexInstructions === "object"
      ? (payload.codexInstructions as Record<string, unknown>)
      : null;
  const contextualUserMessages = codexInstructions?.contextualUserMessages;
  if (!Array.isArray(contextualUserMessages)) {
    return [];
  }
  return contextualUserMessages.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function composeXrouterInput(instructionsText: string, userMessage: string): string {
  if (instructionsText.length === 0) {
    return userMessage;
  }
  if (userMessage.length === 0) {
    return instructionsText;
  }
  return `${instructionsText}\n\n--- user ---\n\n${userMessage}`;
}

function normalizeDiscoveredModels(payload: Record<string, unknown>, preferOpenAiOrdering: boolean): ModelPreset[] {
  const data =
    Array.isArray(payload.data) ? payload.data.filter((entry) => entry !== null && typeof entry === "object") : [];

  const models = data
    .map((entry) => normalizeDiscoveredModelEntry(entry as Record<string, unknown>))
    .filter((entry): entry is ModelPreset => entry !== null);

  if (preferOpenAiOrdering) {
    const preferred = PREFERRED_API_MODELS
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is ModelPreset => model !== undefined);
    const remainder = models.filter((model) => !preferred.some((preferredModel) => preferredModel.id === model.id));
    return [...preferred, ...remainder].map((model, index) => ({
      ...model,
      isDefault: index === 0,
    }));
  }

  return models.map((model, index) => ({
    ...model,
    isDefault: index === 0,
  }));
}

function normalizeDiscoveredModelEntry(entry: Record<string, unknown>): ModelPreset | null {
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    return null;
  }

  const displayName =
    typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : modelIdToDisplayName(entry.id);
  const description = buildModelDescription(entry);

  return {
    id: entry.id,
    displayName,
    description,
    isDefault: false,
    showInPicker: true,
    supportsApi: true,
  };
}

function buildModelDescription(entry: Record<string, unknown>): string | null {
  if (typeof entry.description === "string" && entry.description.trim().length > 0) {
    return entry.description;
  }

  const parts = [
    typeof entry.provider === "string" && entry.provider.trim().length > 0
      ? `provider: ${entry.provider}`
      : null,
    typeof entry.vendor === "string" && entry.vendor.trim().length > 0 ? `vendor: ${entry.vendor}` : null,
    typeof entry.route === "string" && entry.route.trim().length > 0 ? `route: ${entry.route}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(" | ");
}

async function createXrouterClient(codexConfig: CodexCompatibleConfig): Promise<XrouterBrowserClient> {
  const runtime = await loadXrouterRuntime();
  const provider = getActiveProvider(codexConfig);
  console.info("[browser-chat-demo] xrouter.createClient", {
    provider: provider.metadata?.xrouterProvider ?? "deepseek",
    baseUrl: provider.baseUrl.length === 0 ? null : provider.baseUrl,
    hasApiKey: activeProviderApiKey(codexConfig).length > 0,
  });
  return new runtime.WasmBrowserClient(
    provider.metadata?.xrouterProvider ?? "deepseek",
    provider.baseUrl.length === 0 ? null : provider.baseUrl,
    activeProviderApiKey(codexConfig).length === 0 ? null : activeProviderApiKey(codexConfig),
  );
}

async function loadXrouterRuntime(): Promise<XrouterRuntimeModule> {
  xrouterModulePromise ??= loadXrouterRuntimeInner();
  return xrouterModulePromise;
}

async function loadXrouterRuntimeInner(): Promise<XrouterRuntimeModule> {
  const manifest = await loadBuildManifest(XROUTER_MANIFEST_PATH, "xrouter-browser pkg");
  const entryUrl = toBrowserModuleUrl(manifest.entry, manifest.buildId);
  const wasmUrl = toBrowserAssetUrl(manifest.wasm, manifest.buildId);
  const wasm = (await import(/* @vite-ignore */ entryUrl)) as XrouterRuntimeModule;
  console.info("[browser-chat-demo] xrouter.loadRuntime", {
    buildId: manifest.buildId,
    entry: entryUrl,
    wasm: wasmUrl,
  });
  await wasm.default({ module_or_path: wasmUrl });
  return wasm;
}

function isCompletedEvent(event: JsonValue, requestId: string): boolean {
  return (
    event !== null &&
    typeof event === "object" &&
    "type" in event &&
    event.type === "completed" &&
    "requestId" in event &&
    event.requestId === requestId
  );
}

function toProviderLabel(providerId: string): string {
  return modelIdToDisplayName(providerId.trim() || "provider");
}

function defaultXrouterProviderBaseUrl(provider: XrouterProvider): string {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_API_BASE_URL;
    case "openai":
      return OPENAI_API_BASE_URL;
    case "openrouter":
      return OPENROUTER_API_BASE_URL;
    case "zai":
      return ZAI_API_BASE_URL;
  }
}

function toBrowserModuleUrl(path: string, buildId?: string): string {
  if (/^https?:\/\//.test(path)) {
    return appendVersionParam(path, buildId);
  }
  return appendVersionParam(new URL(path, window.location.origin).toString(), buildId);
}

function toBrowserAssetUrl(path: string, buildId?: string): string {
  if (/^https?:\/\//.test(path)) {
    return appendVersionParam(path, buildId);
  }
  return appendVersionParam(new URL(path, window.location.origin).toString(), buildId);
}

function appendVersionParam(url: string, buildId?: string): string {
  if (buildId === undefined || buildId.length === 0) {
    return url;
  }
  const resolved = new URL(url, window.location.origin);
  resolved.searchParams.set("v", buildId);
  return resolved.toString();
}

async function openDemoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions");
      }
      if (!db.objectStoreNames.contains("authState")) {
        db.createObjectStore("authState");
      }
      if (!db.objectStoreNames.contains("providerConfig")) {
        db.createObjectStore("providerConfig");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open demo db"));
  });
}

async function loadStoredSession(threadId: string): Promise<SessionSnapshot | null> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const store = tx.objectStore("sessions");
    const request = store.get(threadId);
    request.onsuccess = () => resolve((request.result as SessionSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("failed to load session"));
  });
}

async function saveStoredSession(snapshot: SessionSnapshot): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const request = store.put(snapshot, snapshot.threadId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save session"));
  });
}

async function deleteStoredSession(threadId: string): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const request = store.delete(threadId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to delete session"));
  });
}

async function loadStoredAuthState(): Promise<AuthState | null> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readonly");
    const store = tx.objectStore("authState");
    const request = store.get("current");
    request.onsuccess = () => resolve((request.result as AuthState | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("failed to load auth state"));
  });
}

async function saveStoredAuthState(authState: AuthState): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readwrite");
    const store = tx.objectStore("authState");
    const request = store.put(authState, "current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save auth state"));
  });
}

async function clearStoredAuthState(): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readwrite");
    const store = tx.objectStore("authState");
    const request = store.delete("current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to clear auth state"));
  });
}

async function loadStoredCodexConfig(): Promise<CodexCompatibleConfig> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readonly");
    const store = tx.objectStore("providerConfig");
    const request = store.get(PROVIDER_CONFIG_KEY);
    request.onsuccess = () =>
      resolve(normalizeCodexConfig((request.result as CodexCompatibleConfig | undefined) ?? DEFAULT_CODEX_CONFIG));
    request.onerror = () => reject(request.error ?? new Error("failed to load provider config"));
  });
}

async function saveStoredCodexConfig(codexConfig: CodexCompatibleConfig): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readwrite");
    const store = tx.objectStore("providerConfig");
    const request = store.put(codexConfig, PROVIDER_CONFIG_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save provider config"));
  });
}

async function clearStoredCodexConfig(): Promise<void> {
  const db = await openDemoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readwrite");
    const store = tx.objectStore("providerConfig");
    const request = store.delete(PROVIDER_CONFIG_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to clear provider config"));
  });
}

async function loadStoredDemoInstructions(): Promise<DemoInstructions> {
  const raw = window.localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
  if (raw === null) {
    return structuredClone(DEFAULT_DEMO_INSTRUCTIONS);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("failed to parse stored browser instructions");
  }

  const payload = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const userInstructions =
    payload.userInstructions !== null && typeof payload.userInstructions === "object"
      ? (payload.userInstructions as Record<string, unknown>)
      : null;
  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  const firstSkill =
    skills[0] !== null && typeof skills[0] === "object" ? (skills[0] as Record<string, unknown>) : null;

  return normalizeDemoInstructions({
    baseInstructions: typeof payload.baseInstructions === "string" ? payload.baseInstructions : "",
    agentsDirectory:
      typeof userInstructions?.directory === "string"
        ? userInstructions.directory
        : DEFAULT_DEMO_INSTRUCTIONS.agentsDirectory,
    agentsInstructions: typeof userInstructions?.text === "string" ? userInstructions.text : "",
    skillName:
      typeof firstSkill?.name === "string" ? firstSkill.name : DEFAULT_DEMO_INSTRUCTIONS.skillName,
    skillPath:
      typeof firstSkill?.path === "string" ? firstSkill.path : DEFAULT_DEMO_INSTRUCTIONS.skillPath,
    skillContents: typeof firstSkill?.contents === "string" ? firstSkill.contents : "",
  });
}

async function loadStoredInstructionSnapshot(threadId: string): Promise<InstructionSnapshot | null> {
  const raw =
    window.localStorage.getItem(`codex.wasm.instructions.${threadId}`) ??
    window.localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`failed to parse instruction snapshot from localStorage for thread ${threadId}`);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`instruction snapshot for thread ${threadId} must be a JSON object`);
  }

  const snapshot = parsed as {
    userInstructions?: InstructionSnapshot["userInstructions"];
    skills?: InstructionSnapshot["skills"];
  };

  return {
    userInstructions: snapshot.userInstructions ?? null,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  };
}

function normalizeDemoInstructions(instructions: DemoInstructions): DemoInstructions {
  return {
    baseInstructions: instructions.baseInstructions.trim(),
    agentsDirectory: instructions.agentsDirectory.trim() || DEFAULT_DEMO_INSTRUCTIONS.agentsDirectory,
    agentsInstructions: instructions.agentsInstructions.trim(),
    skillName: instructions.skillName.trim() || DEFAULT_DEMO_INSTRUCTIONS.skillName,
    skillPath: instructions.skillPath.trim() || DEFAULT_DEMO_INSTRUCTIONS.skillPath,
    skillContents: instructions.skillContents.trim(),
  };
}
