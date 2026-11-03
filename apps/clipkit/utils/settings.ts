import { DEFAULT_GEMINI_MODEL, resolveGeminiModel } from '@repo/ai-client';

export const SETTINGS_KEYS = {
  ApiKey: 'geminiApiKey',
  Model: 'geminiModel',
} as const;

export const LAST_AI_RESULT_KEY = 'clipkitLastAiResult';
export const LAST_CLIP_RESULT_KEY = 'clipkitLastClipResult';

export type ClipkitSettings = {
  apiKey: string;
  model: string;
};

export type LastAiResult = {
  mode: string;
  text: string;
  at: number;
};

export type LastClipResult = {
  title: string;
  text: string;
  at: number;
};

export async function loadSettings(): Promise<ClipkitSettings> {
  const data = await chrome.storage.local.get([SETTINGS_KEYS.ApiKey, SETTINGS_KEYS.Model]);
  const model = resolveGeminiModel(String(data[SETTINGS_KEYS.Model] ?? DEFAULT_GEMINI_MODEL));
  return {
    apiKey: String(data[SETTINGS_KEYS.ApiKey] ?? ''),
    model,
  };
}

export async function saveSettings(settings: ClipkitSettings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEYS.ApiKey]: settings.apiKey.trim(),
    [SETTINGS_KEYS.Model]: resolveGeminiModel(settings.model),
  });
}
