import { db } from '@/src/db/client';
import { captureSnapshots } from '@/src/services/capture';
import { streamChatCompletion, type ToolDescriptor } from '@/src/services/llm';
import { callMcpTool, getMcpServerStatus, listMcpTools } from '@/src/services/mcp';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/src/services/settings';
import type {
  AppSettings,
  BackgroundToUiMessage,
  BootstrapPayload,
  ChatMessageRecord,
  McpServerStatus,
  PendingToolApprovalRecord,
  SessionRecord,
  ToolCallRecord,
  UiToBackgroundMessage,
} from '@/src/types/app';
import { createId, nowIso } from '@/src/utils/ids';
import { safeJsonStringify, truncateText } from '@/src/utils/text';

const ports = new Set<chrome.runtime.Port>();
const MAX_HISTORY_MESSAGES = 12;
const MAX_RECENT_SNAPSHOTS = 6;
let mcpStatusCache: McpServerStatus[] = [];

function postToPort(port: chrome.runtime.Port, message: BackgroundToUiMessage): void {
  try {
    port.postMessage(message);
  } catch {
    ports.delete(port);
  }
}

function broadcast(message: BackgroundToUiMessage): void {
  for (const port of ports) {
    postToPort(port, message);
  }
}

async function listSessions(): Promise<SessionRecord[]> {
  return db.sessions.orderBy('updatedAt').reverse().toArray();
}

async function listMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  return db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
}

async function getPendingApproval(): Promise<PendingToolApprovalRecord | undefined> {
  const approvals = await db.pendingApprovals.orderBy('createdAt').toArray();
  return approvals[0];
}

async function createSession(title = 'New Chat'): Promise<SessionRecord> {
  const timestamp = nowIso();
  const session: SessionRecord = {
    id: createId(),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    messageCount: 0,
  };

  await db.sessions.add(session);
  return session;
}

async function getOrCreateDefaultSession(): Promise<SessionRecord> {
  const existing = await db.sessions.orderBy('updatedAt').reverse().first();
  if (existing) {
    return existing;
  }

  return createSession('Welcome to WebLoom');
}

async function updateSessionAfterMessage(sessionId: string): Promise<void> {
  const messages = await listMessages(sessionId);
  const latest = messages.at(-1);
  const firstUser = messages.find((message) => message.role === 'user');

  await db.sessions.update(sessionId, {
    updatedAt: nowIso(),
    lastMessageAt: latest?.createdAt ?? nowIso(),
    messageCount: messages.length,
    title: firstUser ? truncateText(firstUser.content, 48) : 'New Chat',
  });
}

async function emitSessions(): Promise<void> {
  broadcast({
    type: 'sessions-updated',
    sessions: await listSessions(),
  });
}

async function emitMessages(sessionId: string): Promise<void> {
  broadcast({
    type: 'messages-updated',
    sessionId,
    messages: await listMessages(sessionId),
  });
}

async function emitPendingApproval(): Promise<void> {
  broadcast({
    type: 'pending-approval',
    approval: await getPendingApproval(),
  });
}

async function refreshMcpStatuses(settings?: AppSettings): Promise<McpServerStatus[]> {
  const resolvedSettings = settings ?? (await loadSettings());
  const checkingStatuses = resolvedSettings.mcpServers.map<McpServerStatus>((server) => ({
    serverId: server.id,
    serverName: server.name,
    baseUrl: server.baseUrl,
    enabled: server.enabled,
    state: server.enabled && server.baseUrl.trim() ? 'checking' : server.enabled ? 'not-configured' : 'disabled',
    toolCount: 0,
    tools: [],
    lastCheckedAt: nowIso(),
  }));
  mcpStatusCache = checkingStatuses;
  broadcast({
    type: 'mcp-statuses',
    statuses: checkingStatuses,
  });

  const statuses = await Promise.all(
    resolvedSettings.mcpServers.map((server) => getMcpServerStatus(server)),
  );
  mcpStatusCache = statuses;
  broadcast({
    type: 'mcp-statuses',
    statuses,
  });
  return statuses;
}

async function buildBootstrap(selectedSessionId?: string): Promise<BootstrapPayload> {
  const settings = (await loadSettings()) ?? DEFAULT_SETTINGS;
  const sessions = await listSessions();
  const selected =
    selectedSessionId && sessions.some((session) => session.id === selectedSessionId)
      ? selectedSessionId
      : (sessions[0]?.id ?? (await getOrCreateDefaultSession()).id);

  return {
    sessions: await listSessions(),
    messages: await listMessages(selected),
    selectedSessionId: selected,
    settings,
    pendingApproval: await getPendingApproval(),
    mcpStatuses:
      mcpStatusCache.length === settings.mcpServers.length
        ? mcpStatusCache
        : await refreshMcpStatuses(settings),
  };
}

async function emitBootstrap(port: chrome.runtime.Port, selectedSessionId?: string): Promise<void> {
  postToPort(port, {
    type: 'bootstrap',
    payload: await buildBootstrap(selectedSessionId),
  });
}

async function getRecentHistory(sessionId: string): Promise<ChatMessageRecord[]> {
  const messages = await listMessages(sessionId);
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

async function getRecentSnapshots(sessionId: string) {
  const snapshots = await db.pageSnapshots.where('sessionId').equals(sessionId).sortBy('capturedAt');
  return snapshots.slice(-MAX_RECENT_SNAPSHOTS);
}

async function discoverTools(settings: AppSettings): Promise<ToolDescriptor[]> {
  const enabledServers = settings.mcpServers.filter((server) => server.enabled && server.baseUrl);
  const toolDescriptors: ToolDescriptor[] = [];

  for (const server of enabledServers) {
    try {
      const tools = await listMcpTools(server);
      for (const tool of tools) {
        toolDescriptors.push({
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          namespacedName: `${server.id}__${tool.name}`,
          description: tool.description ?? `${tool.title ?? tool.name} from ${server.name}`,
          inputSchema: tool.inputSchema ?? {
            type: 'object',
            properties: {},
          },
        });
      }
    } catch (error) {
      broadcast({
        type: 'error',
        message: `Failed to load tools from ${server.name}: ${String(error)}`,
      });
    }
  }

  return toolDescriptors;
}

function hydrateToolCalls(
  toolCalls: ToolCallRecord[],
  tools: ToolDescriptor[],
): ToolCallRecord[] {
  return toolCalls.map((toolCall) => {
    const descriptor = tools.find((tool) => tool.namespacedName === toolCall.namespacedName);

    return {
      ...toolCall,
      serverId: descriptor?.serverId ?? '',
      serverName: descriptor?.serverName ?? 'Unknown MCP',
      toolName: descriptor?.toolName ?? toolCall.namespacedName,
    };
  });
}

async function appendMessage(
  message: ChatMessageRecord,
  options?: { replace?: boolean },
): Promise<void> {
  if (options?.replace) {
    await db.messages.put(message);
  } else {
    await db.messages.add(message);
  }
  await updateSessionAfterMessage(message.sessionId);
}

async function runModelTurn(
  sessionId: string,
  settings: AppSettings,
  options?: { enableTools?: boolean },
): Promise<void> {
  const history = await getRecentHistory(sessionId);
  const snapshots = await getRecentSnapshots(sessionId);
  const assistantMessageId = createId();
  const assistantMessage: ChatMessageRecord = {
    id: assistantMessageId,
    sessionId,
    role: 'assistant',
    content: '',
    createdAt: nowIso(),
    status: 'streaming',
    model: settings.llm.model,
  };

  await appendMessage(assistantMessage);
  await emitMessages(sessionId);

  const tools = options?.enableTools === false ? [] : await discoverTools(settings);

  try {
    const streamResult = await streamChatCompletion({
      llm: settings.llm,
      messages: history,
      snapshots,
      tools,
      onTextDelta: async (delta) => {
        assistantMessage.content += delta;
        await appendMessage(assistantMessage, { replace: true });
        await emitMessages(sessionId);
      },
    });

    const hydratedToolCalls = hydrateToolCalls(streamResult.toolCalls, tools);
    assistantMessage.status = 'done';
    assistantMessage.toolCalls = hydratedToolCalls.length ? hydratedToolCalls : undefined;
    assistantMessage.content = streamResult.content || assistantMessage.content;
    await appendMessage(assistantMessage, { replace: true });

    if (hydratedToolCalls[0]) {
      const pendingApproval: PendingToolApprovalRecord = {
        id: createId(),
        sessionId,
        messageId: assistantMessageId,
        toolCallId: hydratedToolCalls[0].id,
        serverId: hydratedToolCalls[0].serverId,
        serverName: hydratedToolCalls[0].serverName,
        toolName: hydratedToolCalls[0].toolName,
        namespacedName: hydratedToolCalls[0].namespacedName,
        argumentsJson: hydratedToolCalls[0].argumentsJson,
        status: 'pending',
        createdAt: nowIso(),
      };

      await db.pendingApprovals.put(pendingApproval);
      await emitPendingApproval();
    }

    await emitMessages(sessionId);
    await emitSessions();
  } catch (error) {
    assistantMessage.status = 'error';
    assistantMessage.errorMessage = String(error);
    assistantMessage.content ||= `Request failed: ${String(error)}`;
    await appendMessage(assistantMessage, { replace: true });
    await emitMessages(sessionId);
    await emitSessions();
  }
}

async function sendUserMessage(sessionId: string, content: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.llm.apiKey || !settings.llm.baseUrl || !settings.llm.model) {
    throw new Error('Please save a valid LLM base URL, API key, and model first.');
  }

  const userMessage: ChatMessageRecord = {
    id: createId(),
    sessionId,
    role: 'user',
    content,
    createdAt: nowIso(),
    status: 'done',
  };

  await appendMessage(userMessage);
  const snapshots = await captureSnapshots(sessionId, settings.captureScope);
  if (snapshots.length) {
    await db.pageSnapshots.bulkAdd(snapshots);
    userMessage.capturedPageIds = snapshots.map((snapshot) => snapshot.id);
    await appendMessage(userMessage, { replace: true });
  }

  await emitMessages(sessionId);
  await emitSessions();
  await runModelTurn(sessionId, settings, { enableTools: true });
}

async function continueAfterToolApproval(
  approval: PendingToolApprovalRecord,
  toolResult: string,
): Promise<void> {
  const toolMessage: ChatMessageRecord = {
    id: createId(),
    sessionId: approval.sessionId,
    role: 'tool',
    content: toolResult,
    createdAt: nowIso(),
    status: 'done',
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
  };

  await appendMessage(toolMessage);
  await db.pendingApprovals.delete(approval.id);
  await emitPendingApproval();
  await emitMessages(approval.sessionId);
  await emitSessions();

  const settings = await loadSettings();
  await runModelTurn(approval.sessionId, settings, { enableTools: false });
}

async function markPendingApprovalProcessing(
  approvalId: string,
): Promise<PendingToolApprovalRecord | undefined> {
  return db.transaction('rw', db.pendingApprovals, async () => {
    const approval = await db.pendingApprovals.get(approvalId);
    if (!approval || approval.status === 'processing') {
      return undefined;
    }

    const processingApproval: PendingToolApprovalRecord = {
      ...approval,
      status: 'processing',
    };
    await db.pendingApprovals.put(processingApproval);
    return processingApproval;
  });
}

async function restorePendingApproval(approval: PendingToolApprovalRecord): Promise<void> {
  await db.pendingApprovals.put({
    ...approval,
    status: 'pending',
  });
  await emitPendingApproval();
}

async function approveToolCall(approvalId: string): Promise<void> {
  const approval = await markPendingApprovalProcessing(approvalId);
  await emitPendingApproval();
  if (!approval) {
    return;
  }

  const settings = await loadSettings();
  const server = settings.mcpServers.find((item) => item.id === approval.serverId);
  if (!server) {
    await restorePendingApproval(approval);
    throw new Error('MCP server configuration not found.');
  }

  try {
    const args = approval.argumentsJson ? JSON.parse(approval.argumentsJson) : {};
    const toolName = approval.namespacedName.split('__').slice(1).join('__');
    const result = await callMcpTool(server, toolName, args);
    await continueAfterToolApproval(approval, safeJsonStringify(result));
  } catch (error) {
    await restorePendingApproval(approval);
    throw error;
  }
}

async function rejectToolCall(approvalId: string): Promise<void> {
  const approval = await markPendingApprovalProcessing(approvalId);
  await emitPendingApproval();
  if (!approval) {
    return;
  }

  await continueAfterToolApproval(
    approval,
    safeJsonStringify({ rejected: true, reason: 'User rejected the tool call.' }),
  );
}

async function handleMessage(
  port: chrome.runtime.Port,
  message: UiToBackgroundMessage,
): Promise<void> {
  switch (message.type) {
    case 'bootstrap': {
      await emitBootstrap(port);
      return;
    }

    case 'load-session': {
      await emitBootstrap(port, message.sessionId);
      return;
    }

    case 'create-session': {
      const session = await createSession();
      await emitSessions();
      await emitBootstrap(port, session.id);
      return;
    }

    case 'rename-session': {
      await db.sessions.update(message.sessionId, {
        title: truncateText(message.title.trim() || 'Untitled Chat', 48),
        updatedAt: nowIso(),
      });
      await emitSessions();
      return;
    }

    case 'delete-session': {
      await db.transaction(
        'rw',
        db.sessions,
        db.messages,
        db.pageSnapshots,
        db.pendingApprovals,
        async () => {
          await db.sessions.delete(message.sessionId);
          await db.messages.where('sessionId').equals(message.sessionId).delete();
          await db.pageSnapshots.where('sessionId').equals(message.sessionId).delete();
          await db.pendingApprovals.where('sessionId').equals(message.sessionId).delete();
        },
      );

      const fallback = await getOrCreateDefaultSession();
      await emitSessions();
      await emitBootstrap(port, fallback.id);
      await emitPendingApproval();
      return;
    }

    case 'save-settings': {
      const settings = await saveSettings(message.settings);
      broadcast({ type: 'settings-updated', settings });
      await refreshMcpStatuses(settings);
      return;
    }

    case 'refresh-mcp-statuses': {
      await refreshMcpStatuses();
      return;
    }

    case 'send-message': {
      await sendUserMessage(message.sessionId, message.content);
      return;
    }

    case 'approve-tool-call': {
      await approveToolCall(message.approvalId);
      return;
    }

    case 'reject-tool-call': {
      await rejectToolCall(message.approvalId);
      return;
    }

    default: {
      const exhaustiveCheck: never = message;
      throw new Error(`Unsupported message: ${String(exhaustiveCheck)}`);
    }
  }
}

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior', error));

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'webloom-sidepanel') {
      return;
    }

    ports.add(port);
    emitBootstrap(port).catch((error) => {
      postToPort(port, {
        type: 'error',
        message: String(error),
      });
    });

    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });

    port.onMessage.addListener((message: UiToBackgroundMessage) => {
      handleMessage(port, message).catch((error) => {
        postToPort(port, {
          type: 'error',
          message: String(error),
        });
      });
    });
  });
});
