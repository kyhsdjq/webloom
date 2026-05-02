import type {
  ChatMessageRecord,
  LlmConfig,
  PageSnapshotRecord,
  ToolCallRecord,
} from '@/src/types/app';

type OpenAiToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolDescriptor = {
  serverId: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type StreamOptions = {
  llm: LlmConfig;
  messages: ChatMessageRecord[];
  snapshots: PageSnapshotRecord[];
  tools: ToolDescriptor[];
  onTextDelta: (delta: string) => Promise<void> | void;
};

type StreamResult = {
  content: string;
  toolCalls: ToolCallRecord[];
};

type StreamDeltaToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildSystemPrompt(snapshots: PageSnapshotRecord[]): string {
  const context =
    snapshots.length === 0
      ? 'No browser context was captured for this turn.'
      : snapshots
          .map((snapshot, index) => {
            return [
              `Page ${index + 1}: ${snapshot.title}`,
              `URL: ${snapshot.url}`,
              snapshot.selection ? `Selection: ${snapshot.selection}` : undefined,
              `Content: ${snapshot.content}`,
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n');

  return [
    'You are WebLoom, a browser-native AI assistant.',
    'Answer using the captured browser context when it is relevant.',
    'Keep answers concise and practical.',
    'If the captured browser context does not directly answer the user, prefer the most relevant tool over guessing.',
    'For factual product or documentation questions such as defaults, ports, config names, entities, relationships, or definitions, use a relevant retrieval tool before saying the information is unavailable.',
    'Do not claim you cannot find information until you have considered the available tools.',
    'Use at most one tool call per turn.',
    '',
    'Captured browser context:',
    context,
  ].join('\n');
}

function toOpenAiMessages(
  messages: ChatMessageRecord[],
  snapshots: PageSnapshotRecord[],
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: buildSystemPrompt(snapshots),
    },
  ];

  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      result.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.namespacedName,
            arguments: toolCall.argumentsJson,
          },
        })),
      });
      continue;
    }

    if (message.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }

    result.push({
      role: message.role,
      content: message.content,
    });
  }

  return result;
}

function toOpenAiTools(tools: ToolDescriptor[]): OpenAiToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.namespacedName,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function parseSseChunk(chunk: string): string[] {
  return chunk
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((line) => line.length > 0);
}

export async function streamChatCompletion(options: StreamOptions): Promise<StreamResult> {
  const { llm, messages, snapshots, tools, onTextDelta } = options;

  const endpoint = `${normalizeBaseUrl(llm.baseUrl)}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify({
      model: llm.model,
      stream: true,
      messages: toOpenAiMessages(messages, snapshots),
      tools: tools.length ? toOpenAiTools(tools) : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error('LLM streaming response body was empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingBuffer = '';
  let content = '';
  const toolCallsByIndex = new Map<number, ToolCallRecord>();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    pendingBuffer += decoder.decode(value, { stream: true });
    const parts = pendingBuffer.split('\n\n');
    pendingBuffer = parts.pop() ?? '';

    for (const part of parts) {
      for (const data of parseSseChunk(part)) {
        if (data === '[DONE]') {
          continue;
        }

        const payload = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: StreamDeltaToolCall[];
            };
          }>;
        };

        const delta = payload.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }

        if (delta.content) {
          content += delta.content;
          await onTextDelta(delta.content);
        }

        if (delta.tool_calls) {
          delta.tool_calls.forEach((toolCallDelta, index) => {
            const existing = toolCallsByIndex.get(index) ?? {
              id: '',
              serverId: '',
              serverName: '',
              toolName: '',
              namespacedName: '',
              argumentsJson: '',
            };

            if (toolCallDelta.id) {
              existing.id = toolCallDelta.id;
            }

            if (toolCallDelta.function?.name) {
              existing.namespacedName = toolCallDelta.function.name;
            }

            if (toolCallDelta.function?.arguments) {
              existing.argumentsJson += toolCallDelta.function.arguments;
            }

            toolCallsByIndex.set(index, existing);
          });
        }
      }
    }
  }

  return {
    content,
    toolCalls: Array.from(toolCallsByIndex.values()),
  };
}

export type { ToolDescriptor };
