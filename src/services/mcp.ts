import type { McpServerConfig, McpServerStatus, McpToolInfo } from '@/src/types/app';
import { nowIso } from '@/src/utils/ids';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse<T> = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_ACCEPT_HEADER = 'application/json, text/event-stream';

type JsonRpcHttpResponse<T> = {
  payload: JsonRpcResponse<T>;
  headers: Headers;
};

function sanitizeHeaders(server: McpServerConfig): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(server.headers ?? {})) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    // Treat common "no auth" placeholders as unset so they do not become real headers.
    if (normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
      continue;
    }

    result[key] = normalized;
  }

  return result;
}

function getSessionId(headers: Headers): string | undefined {
  return (
    headers.get('Mcp-Session-Id') ??
    headers.get('mcp-session-id') ??
    undefined
  );
}

function extractJsonRpcFromSse<T>(raw: string): JsonRpcResponse<T> {
  const dataEntries = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter(Boolean);

  const lastPayload = [...dataEntries].reverse().find((entry) => entry !== '[DONE]');
  if (!lastPayload) {
    throw new Error('MCP server returned an empty SSE response.');
  }

  return JSON.parse(lastPayload) as JsonRpcResponse<T>;
}

async function parseJsonRpcResponse<T>(response: Response): Promise<JsonRpcResponse<T>> {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw || response.statusText}`);
  }

  if (!raw.trim()) {
    return {
      jsonrpc: '2.0',
      id: null,
      result: undefined,
    };
  }

  if (contentType.includes('text/event-stream')) {
    return extractJsonRpcFromSse<T>(raw);
  }

  return JSON.parse(raw) as JsonRpcResponse<T>;
}

async function postJsonRpc<T>(
  server: McpServerConfig,
  payload: JsonRpcRequest,
  options?: { sessionId?: string },
): Promise<JsonRpcHttpResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), server.timeoutMs ?? 15000);

  try {
    const response = await fetch(server.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT_HEADER,
        ...sanitizeHeaders(server),
        ...(options?.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return {
      payload: await parseJsonRpcResponse<T>(response),
      headers: response.headers,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function closeSession(server: McpServerConfig, sessionId?: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), server.timeoutMs ?? 15000);

  try {
    await fetch(server.baseUrl, {
      method: 'DELETE',
      headers: {
        Accept: MCP_ACCEPT_HEADER,
        ...sanitizeHeaders(server),
        'Mcp-Session-Id': sessionId,
      },
      signal: controller.signal,
    });
  } catch {
    // Closing the session is best effort only.
  } finally {
    clearTimeout(timeout);
  }
}

async function openSession(server: McpServerConfig): Promise<string | undefined> {
  const initializeResponse = await postJsonRpc(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: {
        name: 'WebLoom',
        version: '0.1.0',
      },
      capabilities: {},
    },
  });

  if (initializeResponse.payload.error) {
    throw new Error(initializeResponse.payload.error.message);
  }

  const sessionId = getSessionId(initializeResponse.headers);
  await postJsonRpc(server, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }, { sessionId });

  return sessionId;
}

async function withSession<T>(
  server: McpServerConfig,
  operation: (sessionId?: string) => Promise<T>,
): Promise<T> {
  const sessionId = await openSession(server);

  try {
    return await operation(sessionId);
  } finally {
    await closeSession(server, sessionId);
  }
}

export async function listMcpTools(server: McpServerConfig): Promise<McpTool[]> {
  return withSession(server, async (sessionId) => {
    const response = await postJsonRpc<{ tools: McpTool[] }>(
      server,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
      { sessionId },
    );

    if (response.payload.error) {
      throw new Error(response.payload.error.message);
    }

    return response.payload.result?.tools ?? [];
  });
}

export async function callMcpTool(
  server: McpServerConfig,
  name: string,
  args: unknown,
): Promise<unknown> {
  return withSession(server, async (sessionId) => {
    const response = await postJsonRpc<{ content?: unknown; isError?: boolean }>(
      server,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name,
          arguments: args as Record<string, unknown>,
        },
      },
      { sessionId },
    );

    if (response.payload.error) {
      throw new Error(response.payload.error.message);
    }

    if (response.payload.result?.isError) {
      throw new Error(JSON.stringify(response.payload.result.content ?? 'MCP tool returned an error.'));
    }

    return response.payload.result ?? null;
  });
}

export async function getMcpServerStatus(server: McpServerConfig): Promise<McpServerStatus> {
  if (!server.enabled) {
    return {
      serverId: server.id,
      serverName: server.name,
      baseUrl: server.baseUrl,
      enabled: false,
      state: 'disabled',
      toolCount: 0,
      tools: [],
      lastCheckedAt: nowIso(),
    };
  }

  if (!server.baseUrl.trim()) {
    return {
      serverId: server.id,
      serverName: server.name,
      baseUrl: server.baseUrl,
      enabled: true,
      state: 'not-configured',
      toolCount: 0,
      tools: [],
      error: 'Base URL is empty.',
      lastCheckedAt: nowIso(),
    };
  }

  try {
    const tools = await listMcpTools(server);
    const toolInfos: McpToolInfo[] = tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    }));

    return {
      serverId: server.id,
      serverName: server.name,
      baseUrl: server.baseUrl,
      enabled: true,
      state: 'connected',
      toolCount: toolInfos.length,
      tools: toolInfos,
      lastCheckedAt: nowIso(),
    };
  } catch (error) {
    return {
      serverId: server.id,
      serverName: server.name,
      baseUrl: server.baseUrl,
      enabled: true,
      state: 'error',
      toolCount: 0,
      tools: [],
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: nowIso(),
    };
  }
}
