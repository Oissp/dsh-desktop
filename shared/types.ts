/**
 * 共享 IPC 契约类型（renderer ↔ main）。
 *
 * 注意：renderer 永远不直接接触 dsh 的 wire 格式 —— 它只通过 IPC 调用
 * `window.harness.*`，主进程再用 adapter 与 dsh 通信。
 * dsh 上游 API 变更时只需改 adapter，本文件保持不变。
 */

/** dsh 引擎运行状态。 */
export interface DshStatus {
  running: boolean
  ready: boolean
  port: number | null
  version: string | null
  cwd: string | null
  provider: string | null
  model: string | null
  error?: string
  /** 是否处于崩溃恢复态（崩溃环触发，需用户手动重启或已进入恢复页）。 */
  recovery?: boolean
}

/** 应用级设置（存储在 userData 下，与 dsh 数据分开）。 */
export interface AppSettings {
  /** 是否已完成首启向导。 */
  onboarded: boolean
  /** 用户选择的工作区文件夹。 */
  workspaceCwd: string | null
  /** 活跃会话标题快照（sessionId → 标题/最后观测时间），归档列表标题兜底。 */
  sessionTitleSnapshot?: Record<string, { title: string; at: number }>
  /** 已归档会话的本地元数据（sessionId → 标题/cwd/时间），归档时缓存，供归档分组展示与删除定位。 */
  archivedSessionMeta?: Record<string, { title?: string; cwd?: string; archivedAt?: number }>
  /**
   * 已彻底删除的会话 id（墓碑）。dsh 无删除/取消归档 RPC，workspace 归档集合
   * 只增不减，硬删后 id 仍留在 archivedSessionIds 形成"幽灵行"；这里记录后
   * listArchived 过滤掉，保证插件面板里删除即消失。
   */
  purgedSessionIds?: string[]
}

/** 会话摘要（来自 session.list 的归一化视图）。 */
export interface SessionSummary {
  sessionId: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  agentPreset?: string
  planActive?: boolean
}

/** 已归档会话（来自 workspace.follow baseline 的归一化视图）。 */
export interface ArchivedSessionInfo {
  sessionId: string
  /** 标题：优先取归档时本地缓存的元数据，无则 undefined。 */
  title?: string
  /** 工作区路径：从 baseline 的 workspace.sessionIds → path 映射得到，用于删除时定位目录。 */
  cwd?: string
  /** 归档时间（本地缓存，可选）。 */
  archivedAt?: number
}

/** 一条归一化的消息块。 */
export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; callId: string; content: MessageBlock[]; isError?: boolean }

/** 模型目录（llm.models 的归一化视图）。 */
export interface ModelGroup {
  id: string
  name: string
  models: { id: string; name: string; description?: string }[]
}

/**
 * 会话事件流（由 adapter 把 dsh 的 SessionEvent 归一化成稳定词汇，
 * 让消费者只依赖这个稳定词汇）。
 */
export type SessionStreamEvent =
  | { kind: 'session-subscribed'; sessionId: string; lastSeq: number }
  | {
      kind: 'user-message'
      sessionId: string
      seq: number
      /** 消息时间（事件自带才有；归档只读视图用于显示消息时钟）。 */
      time?: number
      message: { id: string; blocks: MessageBlock[] }
    }
  | {
      kind: 'assistant-start'
      sessionId: string
      seq: number
      turn: number
      step: number
    }
  | {
      kind: 'assistant-delta'
      sessionId: string
      seq: number
      turn: number
      step: number
      text: string
      reasoning?: boolean
    }
  | {
      kind: 'assistant-end'
      sessionId: string
      seq: number
      turn: number
      step: number
      /** 消息时间（事件自带才有；归档只读视图用于显示消息时钟）。 */
      time?: number
      message: { id: string; blocks: MessageBlock[] }
      error?: string
    }
  | {
      kind: 'tool-call'
      sessionId: string
      seq: number
      callId: string
      name: string
      arguments: string
    }
  | {
      kind: 'tool-result'
      sessionId: string
      seq: number
      callId: string
      content: MessageBlock[]
      isError?: boolean
      name?: string
    }
  | { kind: 'title'; sessionId: string; seq: number; title: string }
  | { kind: 'projection'; sessionId: string; seq: number; key: string; value: unknown }
  | { kind: 'running'; sessionId: string; running: boolean }

/** IPC 请求结果封装。 */
export interface IpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

/** renderer 通过 preload 暴露的 API。 */
export interface HarnessApi {
  getAppState(): Promise<IpcResult<AppSettings>>
  updateAppSettings(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  getDshStatus(): Promise<IpcResult<DshStatus>>
  ensureDsh(): Promise<IpcResult<DshStatus>>
  /** 手动重启内核（恢复页"重启内核"按钮；清除崩溃环检测器后重新 boot）。 */
  restartDsh(): Promise<IpcResult<DshStatus>>
  /** 从最后良好配置快照回滚后重启（恢复页"回滚配置"按钮）。 */
  restoreCheckpointAndRestart(): Promise<IpcResult<DshStatus>>
  /** 在文件管理器中打开 dsh 配置目录（恢复页"打开配置目录"按钮）。 */
  openConfigDir(): Promise<IpcResult<void>>

  // ---- 首启向导 ----
  createSession(cwd?: string, agentPreset?: string): Promise<IpcResult<{ sessionId: string }>>
  listModels(): Promise<IpcResult<ModelGroup[]>>
  setApiKey(key: string): Promise<IpcResult<void>>
  testApiKey(key: string): Promise<IpcResult<{ ok: boolean; message: string }>>
  pickDirectory(): Promise<IpcResult<string | null>>

  onDshStatus(cb: (status: DshStatus) => void): () => void
}
