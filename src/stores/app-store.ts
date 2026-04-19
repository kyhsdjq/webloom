import { create } from 'zustand';

import type {
  AppSettings,
  ChatMessageRecord,
  PendingToolApprovalRecord,
  SessionRecord,
} from '@/src/types/app';
import { DEFAULT_SETTINGS } from '@/src/services/settings';

type AppState = {
  sessions: SessionRecord[];
  messages: ChatMessageRecord[];
  selectedSessionId: string | null;
  settings: AppSettings;
  pendingApproval?: PendingToolApprovalRecord;
  errorMessage?: string;
  setSessions: (sessions: SessionRecord[]) => void;
  setMessages: (messages: ChatMessageRecord[]) => void;
  setSelectedSessionId: (sessionId: string) => void;
  setSettings: (settings: AppSettings) => void;
  setPendingApproval: (approval?: PendingToolApprovalRecord) => void;
  setErrorMessage: (message?: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  messages: [],
  selectedSessionId: null,
  settings: DEFAULT_SETTINGS,
  pendingApproval: undefined,
  errorMessage: undefined,
  setSessions: (sessions) => set({ sessions }),
  setMessages: (messages) => set({ messages }),
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
  setSettings: (settings) => set({ settings }),
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
}));
