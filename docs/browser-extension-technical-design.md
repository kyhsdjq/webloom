# WebLoom 浏览器插件技术设计

## 1. 目的

本文用于确认 WebLoom 第一版的详细实现技术路径。目标是在 **Chrome 浏览器插件** 中完成一个无后端的轻量 Agent，支持：

- 类 ChatGPT 的本地多会话问答
- 静默自动采集网页上下文
- 三档上下文采集范围
- OpenAI 兼容 LLM 接入
- MCP over HTTP 工具接入
- 工具执行前确认
- 流式输出

本文不再讨论产品方向，而是直接锁定工程实现方案。

## 2. 固定约束

以下约束视为已确认前提：

- 仅支持 Chrome
- 采用 Manifest V3
- 不引入独立后端服务
- 本地持久保存会话
- 上下文静默自动采集
- 上下文范围分为 `当前网页`、`当前窗口所有网页`、`所有打开网页`
- 页面采集以整页正文为主
- MCP 工具调用前必须确认
- 第一版支持流式输出

## 3. 技术选型

## 3.1 总体栈

建议采用以下技术组合：

- `TypeScript`
- `React`
- `WXT`
- `Dexie`
- `Zustand`
- `Zod`
- `@mozilla/readability`

## 3.2 选型说明

### `WXT`

作为浏览器插件工程框架，负责：

- Manifest V3 构建
- `sidePanel`、`background`、`content script` 入口管理
- 开发模式和打包输出

选择原因：

- 比手写 Vite + CRX 配置更省心
- 更适合多入口浏览器插件工程
- 后续如果要扩展 popup/options 也更自然

### `React`

用于构建侧边栏聊天界面与设置页面。

选择原因：

- 适合构建类 ChatGPT 的多会话 UI
- 组件化后易于维护流式消息、工具确认弹层、设置表单等复杂交互

### `Dexie`

作为 `IndexedDB` 的轻量封装，用于持久化：

- 会话
- 消息
- 页面快照
- 会话摘要

选择原因：

- 原生 `IndexedDB` API 过于底层
- 多会话消息和快照数据量较大，不适合只用 `chrome.storage.local`

### `Zustand`

用于侧边栏前端状态管理，主要管理：

- 当前会话状态
- 流式消息状态
- 工具确认弹层状态
- 设置页临时编辑状态

选择原因：

- 比 Redux 更轻
- 对中小型单页状态非常合适

### `Zod`

用于校验：

- LLM 配置
- MCP 服务配置
- 工具参数结构
- 存储层读出的对象

### `@mozilla/readability`

用于在 `content script` 中抽取页面整页正文。

选择原因：

- 相比直接抓 DOM 文本，更适合正文提取
- 能减少导航栏、广告、页脚等噪音

## 3.3 不建议的路径

第一版不建议：

- 引入 Electron 或本地守护进程
- 为了保护 Key 再加一层本地代理服务
- 为插件 UI 引入过重的全量组件库
- 为 MCP 接入依赖必须运行在 Node 侧的传输方式

## 4. 工程目录建议

建议目录结构如下：

```text
docs/
entrypoints/
  background/
    index.ts
  content/
    index.ts
  sidepanel/
    index.html
    main.tsx
    App.tsx
src/
  components/
  features/
    chat/
    sessions/
    settings/
    capture/
    mcp/
  db/
    schema.ts
    client.ts
  services/
    llm/
    mcp/
    capture/
    prompt/
  stores/
  types/
  utils/
wxt.config.ts
package.json
```

模块归属建议：

- `entrypoints/`：插件入口
- `src/features/`：按业务域拆分
- `src/services/`：纯服务逻辑
- `src/db/`：本地数据库
- `src/types/`：共享类型

## 5. 插件模块划分

## 5.1 `sidePanel`

职责：

- 类 ChatGPT 聊天界面
- 会话列表
- 消息流展示
- 工具确认弹层
- 设置页面
- 上下文来源摘要展示

不承担：

- 直接调用 LLM
- 直接调用 MCP
- 直接访问所有标签页内容

它只负责发出用户操作，并接收后台编排结果。

## 5.2 `background service worker`

这是 Agent 主运行时。

职责：

- 接收聊天请求
- 加载当前会话与设置
- 采集网页上下文
- 组装 prompt
- 调用 LLM
- 处理流式输出
- 管理 MCP 工具发现与调用
- 触发工具确认流程
- 更新本地数据库

## 5.3 `content script`

职责：

- 在页面内读取 DOM
- 使用 Readability 提取正文
- 返回结构化页面快照

建议做成“按需采集”，而不是持续监听页面变化。

## 5.4 本地数据库层

职责：

- 保存会话
- 保存消息
- 保存快照
- 保存摘要
- 保存工具调用记录

## 5.5 设置存储层

职责：

- 保存 LLM 配置
- 保存 MCP 服务配置
- 保存采集范围设置
- 保存会话行为设置

建议使用 `chrome.storage.local`。

## 6. 数据模型

## 6.1 会话模型

```ts
type Session = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  messageCount: number
  summary?: string
  archived?: boolean
}
```

## 6.2 消息模型

```ts
type ChatMessage = {
  id: string
  sessionId: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  createdAt: string
  status?: "pending" | "streaming" | "done" | "error"
  toolCallId?: string
  toolName?: string
  meta?: {
    capturedPageIds?: string[]
    model?: string
    errorMessage?: string
  }
}
```

## 6.3 页面快照模型

```ts
type PageSnapshot = {
  id: string
  sessionId?: string
  tabId: number
  windowId: number
  url: string
  title: string
  capturedAt: string
  selection?: string
  content: string
  contentHash: string
}
```

## 6.4 MCP 服务配置

```ts
type McpServerConfig = {
  id: string
  name: string
  baseUrl: string
  transport: "http"
  headers?: Record<string, string>
  enabled: boolean
  toolAllowlist?: string[]
  timeoutMs?: number
}
```

## 6.5 LLM 配置

```ts
type LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  stream: true
  storeApiKeyMode: "session" | "local"
}
```

## 6.6 工具确认模型

```ts
type PendingToolApproval = {
  id: string
  sessionId: string
  serverId: string
  serverName: string
  toolName: string
  argumentsJson: string
  createdAt: string
}
```

## 7. 本地存储方案

## 7.1 `IndexedDB`

建议存以下表：

- `sessions`
- `messages`
- `pageSnapshots`
- `toolApprovals`
- `toolExecutions`

适合放在 `Dexie` 中管理。

## 7.2 `chrome.storage.local`

建议存：

- `llmConfig`
- `captureSettings`
- `mcpServers`
- `uiPreferences`

## 7.3 API Key 存储策略

建议实现两种模式：

### `session`

- API Key 只存在 `background` 内存
- 浏览器关闭或插件重载后失效

### `local`

- API Key 存在 `chrome.storage.local`
- 仅适合用户自带 Key

默认建议：

- 首次使用提示用户选择存储方式
- 默认为 `session`

## 8. UI 设计路径

## 8.1 布局结构

建议采用类似 ChatGPT 的三段式布局：

1. 左侧会话列表
2. 中间消息区
3. 底部输入区

额外区域：

- 顶部模型/上下文状态栏
- 工具确认弹层
- 设置抽屉或独立设置页

## 8.2 会话列表能力

支持：

- 新建会话
- 切换会话
- 重命名
- 删除
- 按最近更新时间排序

第一版不做：

- 置顶
- 文件夹分组
- 云同步

## 8.3 消息区能力

支持：

- 用户消息
- 助手流式消息
- 工具调用提示
- 错误态提示
- 本轮使用上下文摘要

## 8.4 输入区能力

支持：

- 普通发送
- 发送中禁用重复提交
- 展示本轮采集范围
- 展示已纳入上下文的页面数

## 8.5 工具确认弹层

触发时机：

- 模型输出工具调用请求后
- 工具真正执行前

弹层必须展示：

- MCP 服务来源
- 工具名
- 参数 JSON
- 确认按钮
- 取消按钮

取消后的处理建议：

- 将取消结果作为一条 tool-style 结果回填给模型
- 让模型基于“用户拒绝执行工具”继续回答或结束

## 9. 网页采集实现路径

## 9.1 三档采集范围

### `当前网页`

通过：

- `chrome.tabs.query({ active: true, currentWindow: true })`

### `当前窗口所有网页`

通过：

- `chrome.tabs.query({ currentWindow: true })`

### `所有打开网页`

通过：

- `chrome.tabs.query({})`

然后统一过滤不可访问页面：

- `chrome://`
- `chrome-extension://`
- `edge://`
- 无法注入的系统页面

## 9.2 采集调用方式

推荐路径：

1. `background` 收集目标标签页列表
2. 向目标页 `content script` 发送 `CAPTURE_PAGE` 消息
3. `content script` 提取正文并返回 `PageSnapshot`
4. `background` 裁剪、清洗、去重后组装上下文

## 9.3 正文提取策略

提取顺序建议：

1. 当前选中文本
2. Readability 正文
3. `document.body.innerText` 兜底

最终上下文中：

- 如果存在选中文本，可以额外放在高优先级字段
- 页面正文仍然保留，以满足“整页正文优先”的要求

## 9.4 上下文裁剪策略

建议采用以下规则：

- 每个页面限制最大字符数
- 优先保留标题、选中文本、正文前部
- 对重复 URL 快照做去重
- 对长度超限时按页面重要性截断

页面重要性建议排序：

1. 当前激活页
2. 用户有选中文本的页
3. 同窗口其他页
4. 其他窗口页

## 10. 对话上下文组装

## 10.1 原则

需要区分：

- 本地完整历史
- 发给模型的运行时上下文

本地必须保留完整历史，但发送给模型的内容必须裁剪。

## 10.2 第一版组装策略

建议第一版用确定性策略，不先引入复杂记忆系统：

1. 固定 system prompt
2. 取当前会话最近 N 条消息
3. 如果存在会话摘要，则插入摘要
4. 插入本轮网页上下文
5. 插入 MCP 工具定义

推荐默认值：

- 最近消息窗口：10 到 16 条
- 每页正文裁剪：2k 到 6k 字符
- 总上下文上限：按模型能力动态控制

## 10.3 会话摘要策略

第一版建议做成“延后实现但接口预留”：

- 先只使用最近消息窗口
- 当会话明显变长后，再增加摘要生成

原因：

- 能更快做出可用版本
- 摘要本身也依赖 LLM，复杂度更高

## 11. LLM 接入实现路径

## 11.1 接口形式

统一走 OpenAI 兼容接口。

第一版建议优先支持：

- `/v1/chat/completions`

原因：

- 工具调用与流式输出支持更普遍
- 兼容提供商更多

后续可以再加：

- `/v1/responses`

## 11.2 请求结构

建议 `background` 统一构造请求：

```ts
type ChatCompletionRequest = {
  model: string
  stream: true
  messages: Array<{
    role: string
    content?: string
    tool_call_id?: string
    name?: string
  }>
  tools?: Array<{
    type: "function"
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
}
```

## 11.3 流式输出

建议实现：

- `fetch` + `ReadableStream`
- 解析 SSE 风格 chunk

处理流程：

1. 创建 assistant 占位消息，状态为 `streaming`
2. 持续接收 chunk
3. 增量更新消息内容
4. 遇到工具调用片段时切换到工具调用分支
5. 流结束后将消息状态改为 `done`

## 11.4 错误处理

需要覆盖：

- 网络错误
- 401 / 403 鉴权失败
- 429 限流
- 非流式兼容响应
- 模型返回非法工具参数

错误应：

- 在 UI 中可见
- 保存到消息状态
- 不破坏会话历史

## 12. MCP 实现路径

## 12.1 范围收敛

第一版 MCP 只实现工具相关能力：

- 工具发现
- 工具调用

第一版不做：

- resources
- prompts
- sampling
- 依赖本地进程的 transport

## 12.2 适配层设计

建议封装一个统一接口：

```ts
interface McpClient {
  listTools(server: McpServerConfig): Promise<McpTool[]>
  callTool(server: McpServerConfig, name: string, args: unknown): Promise<unknown>
}
```

由 `src/services/mcp/` 提供实现。

## 12.3 工具发现缓存

建议：

- 插件启动时不强制拉全量工具
- 首次使用某 MCP 服务时拉取
- 在本地缓存短时间结果

缓存原因：

- 减少每轮对话的额外延迟
- 降低 MCP 服务压力

## 12.4 工具调用确认流程

完整流程建议为：

1. 模型返回工具调用请求
2. `background` 将其转换为 `PendingToolApproval`
3. `sidePanel` 弹出确认层
4. 用户确认或取消
5. 确认则执行工具调用，取消则生成拒绝结果
6. 将工具结果作为 `tool` 消息再喂给模型
7. 模型生成最终回答

## 12.5 工具参数展示

第一版建议直接展示格式化 JSON。

后续如需增强，可按工具 schema 自动渲染表单，但不作为 v1 要求。

## 13. 通信设计

## 13.1 `sidePanel -> background`

消息类型建议：

- `SEND_CHAT_MESSAGE`
- `LOAD_SESSION`
- `CREATE_SESSION`
- `RENAME_SESSION`
- `DELETE_SESSION`
- `LOAD_SETTINGS`
- `SAVE_SETTINGS`
- `APPROVE_TOOL_CALL`
- `REJECT_TOOL_CALL`

## 13.2 `background -> content script`

消息类型建议：

- `CAPTURE_PAGE`

## 13.3 `background -> sidePanel`

建议通过长连接或事件总线回传：

- 流式文本更新
- 工具确认请求
- 工具执行状态
- 错误状态

推荐路径：

- `chrome.runtime.connect`
- `Port.postMessage`

原因：

- 比零散 `sendMessage` 更适合流式消息更新

## 14. Manifest 与权限路径

建议至少需要：

- `sidePanel`
- `storage`
- `tabs`
- `scripting`
- `activeTab`

`host_permissions` 建议：

- `<all_urls>`

原因：

- 需要支持静默自动采集
- 需要支持“当前窗口所有网页”和“所有打开网页”

需要在产品上明确提示用户：

- 插件会根据设置采集网页正文
- 采集数据默认仅保存在本地并发送到用户配置的 LLM / MCP 服务

## 15. 实施阶段

## 15.1 Phase 1

完成最小可用主链路：

- WXT 工程初始化
- `sidePanel` UI
- 本地多会话
- 当前网页采集
- OpenAI 兼容 LLM 配置
- 流式输出

## 15.2 Phase 2

完成工具链路：

- MCP 服务配置
- 工具发现
- 工具调用确认弹层
- 工具调用与二次推理

## 15.3 Phase 3

完成上下文增强：

- 当前窗口所有网页
- 所有打开网页
- 页面摘要展示
- 更稳定的上下文裁剪

## 15.4 Phase 4

完成质量打磨：

- 错误处理完善
- 恢复机制
- 性能优化
- 权限与隐私提示优化

## 16. 推荐的第一步开发顺序

建议按下面顺序推进：

1. 初始化 `WXT + React + TypeScript`
2. 做出 `sidePanel` 基础聊天 UI
3. 接入 `Dexie`，跑通本地多会话
4. 接入一个 OpenAI 兼容模型，跑通流式聊天
5. 加入 `content script + Readability`，跑通当前网页采集
6. 加入 prompt 组装逻辑
7. 接入 MCP 服务配置
8. 完成工具确认与工具调用闭环
9. 再扩展三档采集范围与更多异常处理

## 17. 明确不做的复杂化设计

第一版暂不引入：

- RAG 服务
- 云端账号
- 服务端会话同步
- 本地模型运行时
- 复杂权限审批流
- 自动表单渲染式工具确认 UI

这样可以保证第一版真正可落地，而不是在架构上过度预留。
