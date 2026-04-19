import type { AppSettings } from '@/src/types/app';

export const DEFAULT_SETTINGS: AppSettings = {
  captureScope: 'active-tab',
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    apiKeyStorageMode: 'session',
  },
  mcpServers: [],
};

const SETTINGS_KEY = 'app-settings';
let sessionApiKey = '';

export async function loadSettings(): Promise<AppSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<AppSettings> | undefined;

  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...stored?.llm,
    },
    mcpServers: stored?.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
  };

  if (merged.llm.apiKeyStorageMode === 'session') {
    merged.llm.apiKey = sessionApiKey;
  }

  return merged;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized: AppSettings = structuredClone(settings);

  if (normalized.llm.apiKeyStorageMode === 'session') {
    sessionApiKey = normalized.llm.apiKey;
    normalized.llm.apiKey = '';
  } else {
    sessionApiKey = '';
  }

  await browser.storage.local.set({
    [SETTINGS_KEY]: normalized,
  });

  const resolved = await loadSettings();
  if (settings.llm.apiKeyStorageMode === 'session') {
    resolved.llm.apiKey = settings.llm.apiKey;
  }
  return resolved;
}
