import { tick } from "svelte";
import { composerStore } from "../stores/composer";
import { inspectorStore } from "../stores/inspector";
import { apsixZoneStore } from "../stores/apsix-zone";
import { runtimeSessionStore } from "../stores/runtime-session";
import { runtimeUiStore } from "../stores/runtime-ui";
import { uiSystemStore } from "../stores/ui-system";
import { ensureApsixWorkspaceSeed } from "../apsix/workspace";
import { UI_THEME_REVISION, UI_THEME_REVISION_STORAGE_KEY } from "../runtime/constants";
import { formatError } from "../runtime";
import { isCancellationError } from "./utils";
import type { UiProfile } from "../ui/profiles";
import type { InspectorTab, UiRenderPlan } from "../ui/types";
import type { ProviderDraft } from "../runtime";
import { UI_PROFILES_PATH } from "../ui/profiles";
import { UI_TOKENS_PATH } from "../ui/tokens";
import { deleteWorkspaceDocuments } from "../ui/workspace";

export async function initializeApp(): Promise<boolean> {
  try {
    console.info("[webui] initialize:start");
    await initializeUiShell();
    const boot = await initializeRuntimeSession();
    console.info("[webui] initialize:done", {
      modelProvider: boot.state.codexConfig.modelProvider,
      model: boot.state.codexConfig.model,
      modelCount: boot.state.models.length,
      defaultTab: uiSystemStore.snapshot().layout.defaultInspectorTab,
    });
    return true;
  } catch (error) {
    console.error("[webui] initialize:failed", error);
    runtimeSessionStore.setError(`Failed to initialize runtime: ${formatError(error)}`);
    return false;
  }
}

export async function initializeUiShell() {
  await syncUiThemeRevision();
  await ensureApsixWorkspaceSeed();
  const nextUiSystem = await uiSystemStore.initialize();
  inspectorStore.setDefaultTab("mission");
  return nextUiSystem;
}

export async function initializeRuntimeSession() {
  return runtimeSessionStore.initialize();
}

async function syncUiThemeRevision(): Promise<void> {
  const currentRevision = window.localStorage.getItem(UI_THEME_REVISION_STORAGE_KEY);
  if (currentRevision === UI_THEME_REVISION) {
    return;
  }
  await deleteWorkspaceDocuments([UI_TOKENS_PATH, UI_PROFILES_PATH]);
  window.localStorage.setItem(UI_THEME_REVISION_STORAGE_KEY, UI_THEME_REVISION);
}

export async function saveProviderConfig(draft: ProviderDraft): Promise<void> {
  try {
    console.info("[webui] ui:save-config", draft);
    await runtimeSessionStore.saveConfig(draft);
    inspectorStore.closeSettings();
  } catch (error) {
    console.error("[webui] ui:save-config:failed", error);
    runtimeSessionStore.setError(`Failed to save provider config: ${formatError(error)}`);
  }
}

export async function refreshAccountAndModels(draft: ProviderDraft): Promise<void> {
  try {
    console.info("[webui] ui:refresh-account-and-models", draft);
    await runtimeSessionStore.refreshAccountAndModels(draft);
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLSelectElement) {
      activeElement.blur();
    }
  } catch (error) {
    console.error("[webui] ui:refresh-account-and-models:failed", error);
    runtimeSessionStore.setError(`Failed to refresh account and models: ${formatError(error)}`);
  }
}

export async function clearAuth(): Promise<void> {
  try {
    console.info("[webui] ui:clear-auth");
    await runtimeSessionStore.clearAuth();
  } catch (error) {
    console.error("[webui] ui:clear-auth:failed", error);
    runtimeSessionStore.setError(`Failed to clear auth: ${formatError(error)}`);
  }
}

export async function sendTurn(): Promise<void> {
  const composerState = composerStore.snapshot();
  const runtimeUiState = runtimeUiStore.snapshot();
  const session = runtimeSessionStore.snapshot();
  const message = composerState.message.trim();
  if (message.length === 0 || runtimeUiState.running) {
    return;
  }
  if (session.providerDraft.model.trim().length === 0) {
    runtimeSessionStore.setError("Select a model before sending a message.");
    return;
  }

  try {
    runtimeUiStore.beginManualTurn(message);
    await apsixZoneStore.beginTurn(message);
    composerStore.setMessage("");
    console.info("[webui] ui:send", {
      message,
      providerDraft: session.providerDraft,
      turnCounter: runtimeUiState.turnCounter,
    });
    runtimeSessionStore.setStatus("Sending turn...", false);
    const outcome = await runtimeSessionStore.runTurn(message, runtimeUiState.turnCounter);
    await apsixZoneStore.finalizeCompletedTurn(outcome.state.transcript);
    runtimeUiStore.finalizeTranscript(
      outcome.state.transcript,
      outcome.result.nextTurnCounter,
    );
    console.info("[webui] ui:send:done", {
      nextTurnCounter: outcome.result.nextTurnCounter,
      transcriptEntries: outcome.state.transcript.length,
      output: outcome.result.output,
    });
  } catch (error) {
    const stopRequested = runtimeUiStore.snapshot().stopRequested;
    runtimeUiStore.markCancelled();
    if (stopRequested || isCancellationError(error)) {
      await apsixZoneStore.block("Zone stopped by user.");
      runtimeSessionStore.setCancelledStatus();
      return;
    }
    console.error("[webui] ui:send:failed", error);
    await apsixZoneStore.block(formatError(error));
    runtimeSessionStore.setError(`Turn failed: ${formatError(error)}`);
  }
}

export async function stopTurn(): Promise<void> {
  const runtimeUiState = runtimeUiStore.snapshot();
  const runtime = runtimeSessionStore.snapshot().state.runtime;
  if (runtimeUiState.activeRequestId === null || runtime === null) {
    console.info("[webui] ui:stop:skipped-no-active-request");
    return;
  }

  try {
    console.info("[webui] ui:stop", { activeRequestId: runtimeUiState.activeRequestId });
    runtimeUiStore.markStopRequested();
    await runtime.cancelModelTurn(runtimeUiState.activeRequestId);
    runtimeUiStore.markCancelled();
    await apsixZoneStore.block("Zone cancelled during execution.");
    runtimeSessionStore.setCancelledStatus();
  } catch (error) {
    console.error("[webui] ui:stop:failed", error);
    runtimeSessionStore.setError(`Failed to stop turn: ${formatError(error)}`);
  }
}

export async function resetThread(): Promise<void> {
  try {
    console.info("[webui] ui:reset-thread");
    await runtimeSessionStore.resetThread();
    runtimeUiStore.resetThread();
    await apsixZoneStore.reset();
    composerStore.reset();
    await tick();
    document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
  } catch (error) {
    console.error("[webui] ui:reset-thread:failed", error);
    runtimeSessionStore.setError(`Failed to reset thread: ${formatError(error)}`);
  }
}

export function toggleEvents(renderPlan: UiRenderPlan): void {
  inspectorStore.toggleEvents(renderPlan.inspectorMode);
}

export function toggleApprovals(renderPlan: UiRenderPlan): void {
  inspectorStore.toggleApprovals(renderPlan.inspectorMode);
}

export function toggleInspectorTab(tab: InspectorTab, renderPlan: UiRenderPlan): void {
  inspectorStore.toggleInspectorTab(tab, renderPlan.inspectorMode);
}

export async function createProfile(): Promise<void> {
  await uiSystemStore.createProfile();
}

export async function saveProfile(profile: UiProfile): Promise<void> {
  await uiSystemStore.saveProfile(profile);
}

export async function activateProfile(profileId: string): Promise<void> {
  await uiSystemStore.activateProfile(profileId);
}

export async function deleteActiveProfile(): Promise<void> {
  await uiSystemStore.deleteActiveProfile();
}
