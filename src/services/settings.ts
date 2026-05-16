import type { AppSettings } from '@/src/types/app';

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'night',
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
const SESSION_API_KEY = 'llm-session-api-key';

async function loadSessionApiKey(): Promise<string> {
  const result = await browser.storage.session.get(SESSION_API_KEY);
  return (result[SESSION_API_KEY] as string | undefined) ?? '';
}

async function saveSessionApiKey(apiKey: string): Promise<void> {
  if (apiKey) {
    await browser.storage.session.set({ [SESSION_API_KEY]: apiKey });
    return;
  }

  await browser.storage.session.remove(SESSION_API_KEY);
}

export async function loadSettings(): Promise<AppSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<AppSettings> | undefined;

  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    themeMode: stored?.themeMode ?? DEFAULT_SETTINGS.themeMode,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...stored?.llm,
    },
    mcpServers: stored?.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
  };

  if (merged.llm.apiKeyStorageMode === 'session') {
    merged.llm.apiKey = await loadSessionApiKey();
  }

  return merged;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized: AppSettings = structuredClone(settings);

  if (normalized.llm.apiKeyStorageMode === 'session') {
    await saveSessionApiKey(normalized.llm.apiKey);
    normalized.llm.apiKey = '';
  } else {
    await saveSessionApiKey('');
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
