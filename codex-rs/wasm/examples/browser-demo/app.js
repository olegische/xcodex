const THREAD_ID = "browser-demo-thread";
const TURN_ID = "browser-demo-turn-1";
const STATUS = document.querySelector("#status");
const RUN_BUTTON = document.querySelector("#run-demo");
const RESET_BUTTON = document.querySelector("#reset-demo");
const WORKSPACE_VIEW = document.querySelector("#workspace-view");
const SEARCH_VIEW = document.querySelector("#search-view");
const EVENTS_VIEW = document.querySelector("#events-view");
const OUTPUT_VIEW = document.querySelector("#output-view");
const PATCH_VIEW = document.querySelector("#patch-view");
const DIFF_VIEW = document.querySelector("#diff-view");

const DEFAULT_FILES = {
  "src/lib.rs": [
    "pub fn greet() -> &'static str {",
    '    "hello"',
    "}",
    "",
  ].join("\n"),
  "README.md": [
    "# Browser Demo Workspace",
    "",
    "- greet() currently returns `hello`.",
    "- The demo patch updates it to a browser-specific greeting.",
    "",
  ].join("\n"),
};

let workspace = createDemoWorkspace();
let runtime = null;

renderWorkspace();
setStatus("Loading WASM runtime…");
void loadRuntime();

RUN_BUTTON.addEventListener("click", () => {
  void runDemoTurn();
});

RESET_BUTTON.addEventListener("click", async () => {
  workspace = createDemoWorkspace();
  await deleteStoredSession();
  renderWorkspace();
  renderSearch([]);
  renderEvents([]);
  renderOutput("");
  renderPatch("");
  renderDiff("");
  setStatus("Workspace reset. Ready for a fresh browser turn.");
});

async function loadRuntime() {
  try {
    const wasm = await import("./pkg/codex_wasm_core.js");
    await wasm.default();
    runtime = new wasm.WasmBrowserRuntime(createBrowserRuntimeHost());
    setStatus("WASM runtime ready. Run the demo turn.");
  } catch (error) {
    setStatus(
      [
        "WASM pkg not found yet.",
        "",
        "Build it from this directory with:",
        "  wasm-pack build ../../core --target web --out-dir ./pkg",
        "",
        `Load error: ${formatError(error)}`,
      ].join("\n"),
      true,
    );
    RUN_BUTTON.disabled = true;
  }
}

async function runDemoTurn() {
  if (runtime === null) {
    return;
  }

  RUN_BUTTON.disabled = true;
  setStatus("Running browser turn…");

  try {
    await ensureThread();

    const searchMatches = workspace.search("src", "greet");
    renderSearch(searchMatches);

    const targetFile = workspace.readFile("src/lib.rs");
    const modelPayload = {
      goal: "Update the greeting string for the browser demo and return an apply_patch block.",
      workspace: {
        files: [
          {
            path: "src/lib.rs",
            content: targetFile.content,
          },
          {
            path: "README.md",
            content: workspace.readFile("README.md").content,
          },
        ],
        matches: searchMatches,
      },
    };

    const dispatch = normalizeHostValue(
      await runtime.runTurn({
        threadId: THREAD_ID,
        turnId: TURN_ID,
        input: [
          {
            type: "text",
            text: "Read the project, propose an apply_patch patch, and update greet().",
          },
        ],
        modelPayload,
      }),
    );
    assertRuntimeDispatch(dispatch);
    renderEvents(dispatch.events);

    const modelText = dispatch.events
      .filter((event) => event.event === "modelDelta")
      .map((event) => event.payload.payload.outputTextDelta)
      .join("");
    renderOutput(modelText);

    const patch = extractPatch(modelText);
    renderPatch(patch ?? "No patch block found in model output.");

    if (patch !== null) {
      const diff = workspace.applyPatch(patch);
      renderDiff(diff.diff);
      renderWorkspace();
      setStatus("Browser turn completed. Patch applied in the demo workspace.");
    } else {
      renderDiff("Patch extraction failed.");
      setStatus("Turn completed, but no patch block was produced.", true);
    }
  } catch (error) {
    console.error("browser demo turn failed", error);
    renderDiff("");
    setStatus(`Demo failed: ${formatError(error)}`, true);
  } finally {
    RUN_BUTTON.disabled = false;
  }
}

async function ensureThread() {
  const existing = await runtime
    .resumeThread({
      threadId: THREAD_ID,
    })
    .then(normalizeHostValue)
    .catch(() => null);
  if (existing !== null) {
    return existing;
  }

  return normalizeHostValue(
    await runtime.startThread({
      threadId: THREAD_ID,
      metadata: {
        workspaceRoot: "/browser-demo",
        demo: true,
      },
    }),
  );
}

function createBrowserRuntimeHost() {
  return {
    async loadSession(threadId) {
      return loadStoredSession(threadId);
    },

    async loadInstructions() {
      return null;
    },

    async saveSession(snapshot) {
      await saveStoredSession(snapshot);
    },

    async startModelTurn(request) {
      const normalizedRequest = normalizeHostValue(request);
      const requestId =
        normalizedRequest !== null &&
        typeof normalizedRequest === "object" &&
        "requestId" in normalizedRequest &&
        typeof normalizedRequest.requestId === "string"
          ? normalizedRequest.requestId
          : null;
      const payload =
        normalizedRequest !== null &&
        typeof normalizedRequest === "object" &&
        "payload" in normalizedRequest
          ? normalizedRequest.payload
          : null;
      const workspacePayload =
        payload !== null &&
        typeof payload === "object" &&
        "workspace" in payload &&
        payload.workspace !== null
          ? payload.workspace
          : null;
      const files =
        workspacePayload !== null &&
        typeof workspacePayload === "object" &&
        "files" in workspacePayload &&
        Array.isArray(workspacePayload.files)
          ? workspacePayload.files
          : null;

      if (requestId === null) {
        throw createHostError("invalidInput", "startModelTurn expected requestId", {
          request: normalizedRequest,
        });
      }
      if (files === null) {
        throw createHostError(
          "invalidInput",
          "startModelTurn expected payload.workspace.files to be an array",
          {
            request: normalizedRequest,
          },
        );
      }

      const targetFile = files.find((file) => file.path === "src/lib.rs");
      if (targetFile === undefined) {
        throw createHostError("notFound", "src/lib.rs was not provided to the model payload", {
          files,
        });
      }

      const patch = buildGreetingPatch(targetFile.content);
      const chunks = [
        "I found the Rust entrypoint in `src/lib.rs` and the current greeting is `hello`.\n\n",
        "Applying a focused patch to keep the browser demo deterministic:\n\n",
        `${patch}\n`,
      ];

      const events = [
        {
          type: "started",
          requestId,
        },
        ...chunks.map((chunk) => ({
          type: "delta",
          requestId,
          payload: {
            outputTextDelta: chunk,
          },
        })),
        {
          type: "completed",
          requestId,
        },
      ];
      return events;
    },

    async cancelModelTurn() {},
  };
}

function createDemoWorkspace() {
  const files = new Map(Object.entries(DEFAULT_FILES));

  return {
    listDir(prefix = "") {
      return [...files.keys()]
        .filter((path) => path.startsWith(prefix))
        .sort()
        .map((path) => ({
          path,
          isDir: false,
          sizeBytes: files.get(path).length,
        }));
    },

    readFile(path) {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return {
        path,
        content,
      };
    },

    search(pathPrefix, query) {
      const matches = [];
      for (const [path, content] of files.entries()) {
        if (!path.startsWith(pathPrefix)) {
          continue;
        }
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          if (line.includes(query)) {
            matches.push({
              path,
              lineNumber: index + 1,
              line,
            });
          }
        });
      }
      return matches;
    },

    applyPatch(patchText) {
      const updateFileMatch = patchText.match(/\*\*\* Update File: ([^\n]+)/);
      if (updateFileMatch === null) {
        throw new Error("Demo patch parser expected `*** Update File:`.");
      }
      const path = updateFileMatch[1];
      const original = this.readFile(path).content;

      const bodyMatch = patchText.match(/@@\n([\s\S]+)\n\*\*\* End Patch/);
      if (bodyMatch === null) {
        throw new Error("Demo patch parser expected a single `@@` hunk.");
      }

      const hunkLines = bodyMatch[1].split("\n");
      const oldBlock = [];
      const newBlock = [];

      for (const line of hunkLines) {
        if (line.startsWith("-")) {
          oldBlock.push(line.slice(1));
          continue;
        }
        if (line.startsWith("+")) {
          newBlock.push(line.slice(1));
          continue;
        }
        if (line.startsWith(" ")) {
          oldBlock.push(line.slice(1));
          newBlock.push(line.slice(1));
        }
      }

      const oldText = oldBlock.join("\n");
      const newText = newBlock.join("\n");
      if (!original.includes(oldText)) {
        throw new Error("Demo patch target block was not found in the workspace file.");
      }

      const updated = original.replace(oldText, newText);
      files.set(path, updated);

      return {
        filesChanged: [path],
        diff: buildDiff(original, updated, path),
      };
    },
  };
}

function buildGreetingPatch(currentContent) {
  const currentGreeting = currentContent.includes("hello from codex-wasm browser demo")
    ? "hello from codex-wasm browser demo"
    : "hello";
  const nextGreeting = "hello from codex-wasm browser demo";

  return [
    "*** Begin Patch",
    "*** Update File: src/lib.rs",
    "@@",
    " pub fn greet() -> &'static str {",
    `-    "${currentGreeting}"`,
    `+    "${nextGreeting}"`,
    " }",
    "*** End Patch",
  ].join("\n");
}

function extractPatch(text) {
  const match = text.match(/\*\*\* Begin Patch[\s\S]*\*\*\* End Patch/);
  return match === null ? null : match[0];
}

function buildDiff(before, after, path) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const diffLines = [`--- ${path}`, `+++ ${path}`];

  for (let index = 0; index < maxLines; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next) {
      if (previous !== undefined) {
        diffLines.push(` ${previous}`);
      }
      continue;
    }
    if (previous !== undefined) {
      diffLines.push(`-${previous}`);
    }
    if (next !== undefined) {
      diffLines.push(`+${next}`);
    }
  }

  return diffLines.join("\n");
}

function renderWorkspace() {
  const lines = workspace.listDir().map((entry) => {
    const content = workspace.readFile(entry.path).content;
    return [`# ${entry.path}`, content].join("\n");
  });
  WORKSPACE_VIEW.textContent = lines.join("\n\n");
}

function renderSearch(matches) {
  SEARCH_VIEW.textContent =
    matches.length === 0
      ? "No search matches yet."
      : matches.map((match) => `${match.path}:${match.lineNumber} ${match.line}`).join("\n");
}

function renderEvents(events) {
  EVENTS_VIEW.textContent =
    events.length === 0 ? "No events yet." : JSON.stringify(events, null, 2);
}

function renderOutput(text) {
  OUTPUT_VIEW.textContent = text.length === 0 ? "No output yet." : text;
}

function renderPatch(text) {
  PATCH_VIEW.textContent = text;
}

function renderDiff(text) {
  DIFF_VIEW.textContent = text.length === 0 ? "No diff yet." : text;
}

function setStatus(message, isError = false) {
  STATUS.textContent = message;
  STATUS.style.color = isError ? "var(--hot)" : "var(--cool)";
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const code =
      "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    const data =
      "data" in error && error.data != null ? ` ${JSON.stringify(error.data)}` : "";
    return `${code}${error.message}${data}`;
  }
  if (error !== null && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return String(error);
}

function createHostError(code, message, data = null) {
  return {
    code,
    message,
    retryable: false,
    data,
  };
}

function normalizeHostValue(value) {
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

function assertRuntimeDispatch(dispatch) {
  if (dispatch === null || typeof dispatch !== "object") {
    throw new Error("runtime.runTurn() returned a non-object dispatch payload");
  }
  if (!("events" in dispatch) || !Array.isArray(dispatch.events)) {
    throw new Error("runtime.runTurn() returned a dispatch payload without an events array");
  }

  dispatch.events
    .filter((event) => event !== null && typeof event === "object" && event.event === "modelDelta")
    .forEach((event) => {
      if (
        !("payload" in event) ||
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

function openSessionDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("codex-wasm-browser-demo", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", {
        keyPath: "threadId",
      });
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("failed to open IndexedDB"));
    };
  });
}

async function loadStoredSession(threadId) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").get(threadId);

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("failed to load session"));
    };
  });
}

async function saveStoredSession(snapshot) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put(snapshot);
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("failed to save session"));
    };
  });
}

async function deleteStoredSession() {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").delete(THREAD_ID);
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("failed to delete session"));
    };
  });
}
