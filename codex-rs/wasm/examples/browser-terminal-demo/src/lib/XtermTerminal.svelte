<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { Terminal } from "xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "xterm/css/xterm.css";

  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveAssistantText = "";
  export let running = false;
  export let disabled = false;
  export let model = "";
  export let cwd = "~/workspace";

  const dispatch = createEventDispatcher<{
    submit: { value: string };
    draftchange: { value: string };
    cancel: {};
  }>();

  let host: HTMLDivElement | null = null;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let draft = "";

  $: if (term !== null) {
    transcript;
    liveAssistantText;
    running;
    disabled;
    model;
    cwd;
    draft;
    redrawTerminal();
  }
  $: dispatch("draftchange", { value: draft });

  onMount(() => {
    term = new Terminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Berkeley Mono, IBM Plex Mono, Menlo, Consolas, monospace",
      fontSize: 16,
      lineHeight: 1.35,
      theme: {
        background: "#262626",
        foreground: "#e6d7a8",
        cursor: "#e6d7a8",
        cursorAccent: "#262626",
        black: "#262626",
        red: "#d7786a",
        green: "#92c98a",
        yellow: "#d8d14a",
        blue: "#4aa0a8",
        magenta: "#a29774",
        cyan: "#4aa0a8",
        white: "#e6d7a8",
        brightBlack: "#8f845f",
        brightRed: "#d7786a",
        brightGreen: "#92c98a",
        brightYellow: "#d8d14a",
        brightBlue: "#4aa0a8",
        brightMagenta: "#c3b283",
        brightCyan: "#4aa0a8",
        brightWhite: "#f3e8c5",
      },
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();
    term.onData(handleInput);
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    if (host !== null) {
      resizeObserver.observe(host);
    }
    redrawTerminal();
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    term?.dispose();
  });

  function redrawTerminal() {
    if (term === null) {
      return;
    }

    term.clear();
    term.write("\x1b[33mbrowser@codex-wasm\x1b[0m \x1b[93m~/workspace\x1b[0m > \x1b[36mcodex\x1b[0m\r\n");
    term.write("\r\n");
    term.write(`\x1b[36mWASM Codex\x1b[0m \x1b[90m(wasm_v2)\x1b[0m\r\n`);
    term.write(`\x1b[90mmodel:\x1b[0m ${model || "not selected"}\r\n`);
    term.write(`\x1b[90mdirectory:\x1b[0m ${cwd}\r\n`);
    term.write("\r\n");

    for (const entry of transcript) {
      term.write(formatEntry(entry));
    }

    if (running && liveAssistantText.length > 0) {
      term.write(`\x1b[32m•\x1b[0m ${normalizeText(liveAssistantText)}\r\n`);
    }

    term.write("\r\n");
    term.write(`\x1b[90m${model || "no-model"} · ${running ? "thinking" : "ready"} · ${cwd}\x1b[0m\r\n`);
    renderPrompt();
  }

  function renderPrompt() {
    if (term === null) {
      return;
    }
    term.write(`\x1b[36m>\x1b[0m ${draft}`);
  }

  function handleInput(data: string) {
    if (disabled || term === null) {
      return;
    }

    if (data === "\r") {
      const value = draft.trim();
      if (value.length === 0) {
        return;
      }
      draft = "";
      dispatch("submit", { value });
      redrawTerminal();
      return;
    }

    if (data === "\u007f") {
      if (draft.length === 0) {
        return;
      }
      draft = draft.slice(0, -1);
      redrawTerminal();
      return;
    }

    if (data === "\u0003" || data === "\u001b") {
      dispatch("cancel", {});
      return;
    }

    if (data >= " " && data !== "\u007f") {
      draft += data;
      redrawTerminal();
    }
  }

  function formatEntry(entry: TranscriptEntry): string {
    const marker = entry.role === "user" ? "\x1b[36m>\x1b[0m" : entry.role === "assistant" ? "\x1b[33m•\x1b[0m" : "\x1b[90m@\x1b[0m";
    return `${marker} ${normalizeText(entry.text)}\r\n\r\n`;
  }

  function normalizeText(value: string): string {
    return value.replace(/\n/g, "\r\n");
  }

</script>

<div bind:this={host} class="xterm-shell"></div>
