import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '@/src/stores/app-store';
import type {
  AppSettings,
  BackgroundToUiMessage,
  McpServerConfig,
  McpServerStatus,
  UiToBackgroundMessage,
} from '@/src/types/app';
import { createId } from '@/src/utils/ids';

import './App.css';

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    llm: { ...settings.llm },
    mcpServers: settings.mcpServers.map((server) => ({
      ...server,
      headers: { ...(server.headers ?? {}) },
    })),
  };
}

function statusLabel(status: McpServerStatus['state']): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'checking':
      return 'Checking';
    case 'disabled':
      return 'Disabled';
    case 'not-configured':
      return 'Not configured';
    case 'error':
      return 'Connection failed';
    default:
      return status;
  }
}

function App() {
  const {
    sessions,
    messages,
    selectedSessionId,
    settings,
    mcpStatuses,
    pendingApproval,
    errorMessage,
    setSessions,
    setMessages,
    setSelectedSessionId,
    setSettings,
    setMcpStatuses,
    setPendingApproval,
    setErrorMessage,
  } = useAppStore();
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId);
  const [draft, setDraft] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editableSettings, setEditableSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    setEditableSettings(cloneSettings(settings));
  }, [settings]);

  useEffect(() => {
    const port = browser.runtime.connect({ name: 'webloom-sidepanel' });
    portRef.current = port;

    const handlePortMessage = (message: BackgroundToUiMessage) => {
      switch (message.type) {
        case 'bootstrap':
          setSessions(message.payload.sessions);
          setMessages(message.payload.messages);
          setSelectedSessionId(message.payload.selectedSessionId);
          setSettings(message.payload.settings);
          setMcpStatuses(message.payload.mcpStatuses);
          setPendingApproval(message.payload.pendingApproval);
          setErrorMessage(undefined);
          break;
        case 'sessions-updated':
          setSessions(message.sessions);
          break;
        case 'messages-updated':
          if (message.sessionId === selectedSessionIdRef.current) {
            setMessages(message.messages);
          }
          break;
        case 'settings-updated':
          setSettings(message.settings);
          break;
        case 'mcp-statuses':
          setMcpStatuses(message.statuses);
          break;
        case 'pending-approval':
          setPendingApproval(message.approval);
          break;
        case 'error':
          setErrorMessage(message.message);
          break;
        default:
          break;
      }
    };

    port.onMessage.addListener(handlePortMessage);
    port.postMessage({ type: 'bootstrap' } satisfies UiToBackgroundMessage);

    return () => {
      port.onMessage.removeListener(handlePortMessage);
      port.disconnect();
    };
  }, [
    setErrorMessage,
    setMessages,
    setMcpStatuses,
    setPendingApproval,
    setSelectedSessionId,
    setSessions,
    setSettings,
  ]);

  const isStreaming = useMemo(
    () => messages.some((message) => message.status === 'streaming'),
    [messages],
  );

  function send(message: UiToBackgroundMessage) {
    portRef.current?.postMessage(message);
  }

  function handleCreateSession() {
    send({ type: 'create-session' });
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    send({ type: 'load-session', sessionId });
  }

  function handleRenameSession(sessionId: string, currentTitle: string) {
    const title = window.prompt('Rename chat', currentTitle);
    if (!title) {
      return;
    }

    send({ type: 'rename-session', sessionId, title });
  }

  function handleDeleteSession(sessionId: string) {
    if (!window.confirm('Delete this chat?')) {
      return;
    }

    send({ type: 'delete-session', sessionId });
  }

  function handleSaveSettings() {
    send({ type: 'save-settings', settings: editableSettings });
    setIsSettingsOpen(false);
  }

  function handleRefreshMcpStatuses() {
    send({ type: 'refresh-mcp-statuses' });
  }

  function handleToolApproval(decision: 'approve' | 'reject') {
    if (!pendingApproval || pendingApproval.status === 'processing') {
      return;
    }

    const approvalId = pendingApproval.id;
    setPendingApproval({
      ...pendingApproval,
      status: 'processing',
    });
    send({
      type: decision === 'approve' ? 'approve-tool-call' : 'reject-tool-call',
      approvalId,
    });
  }

  function handleSend() {
    const content = draft.trim();
    if (!content || !selectedSessionId || isStreaming) {
      return;
    }

    send({
      type: 'send-message',
      sessionId: selectedSessionId,
      content,
    });
    setDraft('');
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSend();
  }

  function updateServer(index: number, nextServer: McpServerConfig) {
    setEditableSettings((current) => {
      const nextServers = [...current.mcpServers];
      nextServers[index] = nextServer;
      return { ...current, mcpServers: nextServers };
    });
  }

  function addServer() {
    setEditableSettings((current) => ({
      ...current,
      mcpServers: [
        ...current.mcpServers,
        {
          id: createId(),
          name: 'New MCP Server',
          baseUrl: '',
          headers: {},
          enabled: true,
          timeoutMs: 15000,
        },
      ],
    }));
  }

  function removeServer(serverId: string) {
    setEditableSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.filter((server) => server.id !== serverId),
    }));
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__header">
          <h1>WebLoom</h1>
          <button onClick={handleCreateSession}>New Chat</button>
        </div>
        <div className="sidebar__list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-card ${selectedSessionId === session.id ? 'session-card--active' : ''}`}
            >
              <button className="session-card__select" onClick={() => handleSelectSession(session.id)}>
                <span className="session-card__title">{session.title}</span>
                <span className="session-card__time">
                  {new Date(session.updatedAt).toLocaleString()}
                </span>
              </button>
              <div className="session-card__actions">
                <button onClick={() => handleRenameSession(session.id, session.title)}>Rename</button>
                <button onClick={() => handleDeleteSession(session.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="panel">
        <header className="panel__header">
          <div>
            <strong>Capture</strong> {settings.captureScope}
          </div>
          <div>
            <strong>Model</strong> {settings.llm.model || 'Not configured'}
          </div>
          <button onClick={() => setIsSettingsOpen((current) => !current)}>Settings</button>
        </header>

        {errorMessage ? <div className="banner banner--error">{errorMessage}</div> : null}

        <section className="mcp-status-panel">
          <div className="mcp-status-panel__header">
            <div>
              <h2>MCP Servers</h2>
              <p>Validate whether each remote MCP tool server is reachable and which tools it exposes.</p>
            </div>
            <button onClick={handleRefreshMcpStatuses}>Refresh</button>
          </div>

          <div className="mcp-status-grid">
            {mcpStatuses.length ? (
              mcpStatuses.map((status) => (
                <article key={status.serverId} className="mcp-status-card">
                  <div className="mcp-status-card__header">
                    <div>
                      <strong>{status.serverName}</strong>
                      <div className="mcp-status-card__url">{status.baseUrl || 'No URL configured'}</div>
                    </div>
                    <span className={`status-pill status-pill--${status.state}`}>
                      {statusLabel(status.state)}
                    </span>
                  </div>

                  <div className="mcp-status-card__meta">
                    <span>{status.toolCount} tools</span>
                    {status.lastCheckedAt ? (
                      <span>{new Date(status.lastCheckedAt).toLocaleTimeString()}</span>
                    ) : null}
                  </div>

                  {status.error ? <div className="mcp-status-card__error">{status.error}</div> : null}

                  {status.tools.length ? (
                    <div className="mcp-tool-list">
                      {status.tools.map((tool) => (
                        <div key={`${status.serverId}-${tool.name}`} className="mcp-tool-list__item">
                          <div className="mcp-tool-list__name">{tool.title || tool.name}</div>
                          <div className="mcp-tool-list__id">{tool.name}</div>
                          {tool.description ? (
                            <div className="mcp-tool-list__description">{tool.description}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mcp-tool-list__empty">
                      {status.state === 'connected'
                        ? 'Connected, but no tools were returned.'
                        : 'No tools available to display.'}
                    </div>
                  )}
                </article>
              ))
            ) : (
              <div className="mcp-tool-list__empty">No MCP servers configured yet.</div>
            )}
          </div>
        </section>

        <section className="messages">
          {messages.map((message) => (
            <article key={message.id} className={`message message--${message.role}`}>
              <div className="message__meta">
                <span>{message.role}</span>
                {message.status ? <span>{message.status}</span> : null}
                {message.capturedPageIds?.length ? (
                  <span>{message.capturedPageIds.length} pages captured</span>
                ) : null}
              </div>
              <div className="message__content">{message.content || ' '}</div>
              {message.toolCalls?.length ? (
                <div className="tool-call">
                  <strong>Tool request</strong>
                  <div>{message.toolCalls[0].serverName}</div>
                  <div>{message.toolCalls[0].toolName}</div>
                  <pre>{message.toolCalls[0].argumentsJson}</pre>
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <footer className="composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask about the page you're reading..."
          />
          <div className="composer__actions">
            <span>{isStreaming ? 'Assistant is responding...' : 'Ready'}</span>
            <button disabled={!draft.trim() || isStreaming} onClick={handleSend}>
              Send
            </button>
          </div>
        </footer>
      </main>

      {isSettingsOpen ? (
        <section className="settings">
          <div className="settings__header">
            <h2>Settings</h2>
            <button onClick={() => setIsSettingsOpen(false)}>Close</button>
          </div>

          <label>
            Base URL
            <input
              value={editableSettings.llm.baseUrl}
              onChange={(event) =>
                setEditableSettings((current) => ({
                  ...current,
                  llm: { ...current.llm, baseUrl: event.target.value },
                }))
              }
            />
          </label>

          <label>
            API Key
            <input
              type="password"
              value={editableSettings.llm.apiKey}
              onChange={(event) =>
                setEditableSettings((current) => ({
                  ...current,
                  llm: { ...current.llm, apiKey: event.target.value },
                }))
              }
            />
          </label>

          <label>
            Model
            <input
              value={editableSettings.llm.model}
              onChange={(event) =>
                setEditableSettings((current) => ({
                  ...current,
                  llm: { ...current.llm, model: event.target.value },
                }))
              }
            />
          </label>

          <label>
            API Key Storage
            <select
              value={editableSettings.llm.apiKeyStorageMode}
              onChange={(event) =>
                setEditableSettings((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    apiKeyStorageMode: event.target.value as AppSettings['llm']['apiKeyStorageMode'],
                  },
                }))
              }
            >
              <option value="session">Session only (clears when browser exits)</option>
              <option value="local">Persist locally (stored on this device)</option>
            </select>
            <small>
              {editableSettings.llm.apiKeyStorageMode === 'session'
                ? 'Keeps the API key for the current browser session. Closing the side panel will not clear it, but fully exiting the browser will.'
                : 'Keeps the API key on this device until you change it, clear extension data, or remove the extension.'}
            </small>
          </label>

          <label>
            Capture Scope
            <select
              value={editableSettings.captureScope}
              onChange={(event) =>
                setEditableSettings((current) => ({
                  ...current,
                  captureScope: event.target.value as AppSettings['captureScope'],
                }))
              }
            >
              <option value="active-tab">Current page</option>
              <option value="current-window">Current window pages</option>
              <option value="all-tabs">All open pages</option>
            </select>
          </label>

          <div className="settings__section">
            <div className="settings__section-header">
              <h3>MCP Servers</h3>
              <div className="settings__section-actions">
                <button onClick={handleRefreshMcpStatuses}>Refresh Status</button>
                <button onClick={addServer}>Add</button>
              </div>
            </div>

            {editableSettings.mcpServers.map((server, index) => (
              <div key={server.id} className="server-card">
                {(() => {
                  const status = mcpStatuses.find((item) => item.serverId === server.id);
                  return status ? (
                    <div className="server-card__status">
                      <span className={`status-pill status-pill--${status.state}`}>
                        {statusLabel(status.state)}
                      </span>
                      <span>{status.toolCount} tools</span>
                    </div>
                  ) : null;
                })()}
                <label>
                  Name
                  <input
                    value={server.name}
                    onChange={(event) =>
                      updateServer(index, {
                        ...server,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Base URL
                  <input
                    value={server.baseUrl}
                    onChange={(event) =>
                      updateServer(index, {
                        ...server,
                        baseUrl: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Authorization Header
                  <input
                    value={server.headers?.Authorization ?? ''}
                    onChange={(event) =>
                      updateServer(index, {
                        ...server,
                        headers: {
                          ...(server.headers ?? {}),
                          Authorization: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Timeout (ms)
                  <input
                    type="number"
                    value={server.timeoutMs ?? 15000}
                    onChange={(event) =>
                      updateServer(index, {
                        ...server,
                        timeoutMs: Number(event.target.value) || 15000,
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(event) =>
                      updateServer(index, {
                        ...server,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  Enabled
                </label>
                {(() => {
                  const status = mcpStatuses.find((item) => item.serverId === server.id);
                  if (!status) {
                    return null;
                  }

                  return (
                    <div className="server-card__tools">
                      {status.error ? <div className="server-card__error">{status.error}</div> : null}
                      {status.tools.length ? (
                        status.tools.map((tool) => (
                          <div key={`${server.id}-${tool.name}`} className="server-card__tool">
                            <div className="server-card__tool-name">{tool.title || tool.name}</div>
                            <div className="server-card__tool-id">{tool.name}</div>
                          </div>
                        ))
                      ) : (
                        <div className="server-card__empty">No tools discovered.</div>
                      )}
                    </div>
                  );
                })()}
                <button onClick={() => removeServer(server.id)}>Remove</button>
              </div>
            ))}
          </div>

          <button className="primary" onClick={handleSaveSettings}>
            Save Settings
          </button>
        </section>
      ) : null}

      {pendingApproval?.status === 'pending' ? (
        <div className="approval-modal">
          <div className="approval-modal__card">
            <h2>Tool approval required</h2>
            <p>
              <strong>MCP</strong> {pendingApproval.serverName}
            </p>
            <p>
              <strong>Tool</strong> {pendingApproval.toolName}
            </p>
            <pre>{pendingApproval.argumentsJson}</pre>
            <div className="approval-modal__actions">
              <button onClick={() => handleToolApproval('reject')}>
                Reject
              </button>
              <button className="primary" onClick={() => handleToolApproval('approve')}>
                Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
