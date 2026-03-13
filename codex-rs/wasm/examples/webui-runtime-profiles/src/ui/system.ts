import { ensureUiLayoutDocument, subscribeUiLayout } from "./layout";
import { ensureUiProfilesDocument, subscribeUiProfiles } from "./profiles";
import { applyThemeTokens, ensureUiTokensDocument, subscribeUiTokens } from "./tokens";
import { ensureUiWidgetsDocument, subscribeUiWidgets } from "./widgets";
import { resolveActiveUiProfile } from "./profiles";
import type { UiSystemDocument } from "./types";

export async function loadUiSystem(): Promise<UiSystemDocument> {
  const [tokens, profiles, layout, widgets] = await Promise.all([
    ensureUiTokensDocument(),
    ensureUiProfilesDocument(),
    ensureUiLayoutDocument(),
    ensureUiWidgetsDocument(),
  ]);
  return { tokens, profiles, layout, widgets };
}

export function subscribeUiSystem(listener: (document: UiSystemDocument) => void): () => void {
  let state: UiSystemDocument | null = null;

  const emit = async () => {
    state = await loadUiSystem();
    listener(state);
  };

  const unsubscribers = [subscribeUiTokens(emit), subscribeUiProfiles(emit), subscribeUiLayout(emit), subscribeUiWidgets(emit)];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export function applyUiSystem(document: UiSystemDocument): void {
  const profile = resolveActiveUiProfile(document.profiles);
  const themeTokens = document.tokens.themes[profile.theme] ?? {};
  applyThemeTokens(profile.theme, {
    ...themeTokens,
    ...profile.tokens,
  });
}
