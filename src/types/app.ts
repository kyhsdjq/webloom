export type CaptureScope = 'active-tab' | 'current-window' | 'all-tabs';

export type ApiKeyStorageMode = 'session' | 'local';

export type ThemeMode = 'day' | 'night';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';

export type ToolCallRecord = {
  id: string;
  serverId: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  argumentsJson: string;
};

export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
};

export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallRecord[];
  capturedPageIds?: string[];
  errorMessage?: string;
  model?: string;
};

export type PageSnapshotRecord = {
  id: string;
  sessionId: string;
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  capturedAt: string;
  selection?: string;
  content: string;
  contentHash: string;
};

export type McpServerConfig = {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  enabled: boolean;
  timeoutMs?: number;
};

export type McpToolInfo = {
  name: string;
  title?: string;
  description?: string;
};

export type McpServerStatusState =
  | 'disabled'
  | 'not-configured'
  | 'checking'
  | 'connected'
  | 'error';

export type McpServerStatus = {
  serverId: string;
  serverName: string;
  baseUrl: string;
  enabled: boolean;
  state: McpServerStatusState;
  toolCount: number;
  tools: McpToolInfo[];
  error?: string;
  lastCheckedAt?: string;
};

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiKeyStorageMode: ApiKeyStorageMode;
};

export type AppSettings = {
  themeMode: ThemeMode;
  captureScope: CaptureScope;
  llm: LlmConfig;
  mcpServers: McpServerConfig[];
};

export type PendingToolApprovalRecord = {
  id: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  argumentsJson: string;
  status: 'pending' | 'processing';
  createdAt: string;
};

export type BootstrapPayload = {
  sessions: SessionRecord[];
  messages: ChatMessageRecord[];
  selectedSessionId: string;
  settings: AppSettings;
  pendingApproval?: PendingToolApprovalRecord;
  mcpStatuses: McpServerStatus[];
};

export type BrowserPageSnapshot = {
  title: string;
  url: string;
  capturedAt: string;
  selection?: string;
  content: string;
};

export type UiToBackgroundMessage =
  | { type: 'bootstrap' }
  | { type: 'load-session'; sessionId: string }
  | { type: 'create-session' }
  | { type: 'rename-session'; sessionId: string; title: string }
  | { type: 'delete-session'; sessionId: string }
  | { type: 'save-settings'; settings: AppSettings }
  | { type: 'refresh-mcp-statuses' }
  | { type: 'send-message'; sessionId: string; content: string }
  | { type: 'approve-tool-call'; approvalId: string }
  | { type: 'reject-tool-call'; approvalId: string };

export type BackgroundToUiMessage =
  | { type: 'bootstrap'; payload: BootstrapPayload }
  | { type: 'sessions-updated'; sessions: SessionRecord[] }
  | { type: 'messages-updated'; sessionId: string; messages: ChatMessageRecord[] }
  | { type: 'settings-updated'; settings: AppSettings }
  | { type: 'pending-approval'; approval?: PendingToolApprovalRecord }
  | { type: 'mcp-statuses'; statuses: McpServerStatus[] }
  | { type: 'error'; message: string };
