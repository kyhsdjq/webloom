import type { McpServerConfig } from '@/src/types/app';

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

async function postJsonRpc<T>(
  server: McpServerConfig,
  payload: JsonRpcRequest,
): Promise<JsonRpcResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), server.timeoutMs ?? 15000);

  try {
    const response = await fetch(server.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...server.headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return (await response.json()) as JsonRpcResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function initializeServer(server: McpServerConfig): Promise<void> {
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

  if (initializeResponse.error) {
    throw new Error(initializeResponse.error.message);
  }

  await postJsonRpc(server, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
}

export async function listMcpTools(server: McpServerConfig): Promise<McpTool[]> {
  await initializeServer(server);

  const response = await postJsonRpc<{ tools: McpTool[] }>(server, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.result?.tools ?? [];
}

export async function callMcpTool(
  server: McpServerConfig,
  name: string,
  args: unknown,
): Promise<unknown> {
  await initializeServer(server);

  const response = await postJsonRpc<{ content?: unknown; isError?: boolean }>(server, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name,
      arguments: args as Record<string, unknown>,
    },
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.result ?? null;
}
