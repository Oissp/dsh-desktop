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
   * 硬删后待取消归档的会话 id（自清空队列，非永久墓碑）。
   *
   * 硬删依赖"归档"把会话从活跃列表隐藏；删掉日志文件后还要调
   * workspace/unarchiveSession 才能把 id 从引擎归档集合里摘掉（0.1.6-alpha.1
   * 起提供，此前只能永久留在集合里）。但引擎仍持有该会话（live）时不能摘——
   * session.list 会合并内存里的会话，摘掉等于让它带着原 workspace 槽位复活到
   * 活跃列表。这类 id 暂存于此：listArchived 先过滤掉（插件面板里删除即消失），
   * 快照轮询发现引擎已遗忘后补摘，摘成功即从队列移除并清掉本地痕迹。
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
  | {
      /** 步骤结束（DSH 0.2.1+ 事件 step/end）。 */
      kind: 'step-end'
      sessionId: string
      seq: number
      turn: number
      step: number
    }
  | {
      /**
       * 系统消息（DSH 0.2.1+ 事件 system/message）：引擎注入的上下文消息，
       * 与 user/message（source.kind=user）不同，不影响 running 状态。
       */
      kind: 'system-message'
      sessionId: string
      seq: number
      time?: number
      message: { id: string; blocks: MessageBlock[] }
    }
  | {
      /**
       * 开发者消息（DSH 0.2.1+ 事件 developer/message）：开发者注入的消息，
       * 归档历史可见，保留上下文。
       */
      kind: 'developer-message'
      sessionId: string
      seq: number
      time?: number
      message: { id: string; blocks: MessageBlock[] }
    }
  | {
      /**
       * 上下文压缩摘要（DSH 0.2.1+ 事件 compaction/summary）：
       * 引擎压缩上下文后发出的摘要，归档历史可见。
       */
      kind: 'compaction-summary'
      sessionId: string
      seq: number
      summary: string
    }
  | {
      /**
       * 子代理活动（DSH 0.2.1+ 事件 subagent/start、subagent/end）：
       * 子代理生命周期，归档历史可见。
       */
      kind: 'subagent-activity'
      sessionId: string
      seq: number
      /** 'start' | 'end' */
      phase: string
      /** 子代理名称或 id（可选）。 */
      name?: string
    }
  | {
      /**
       * 命令执行（DSH 0.2.1+ 事件 command/run、command/done）：
       * 斜杠命令的执行记录，归档历史可见。
       */
      kind: 'command'
      sessionId: string
      seq: number
      /** 'run' | 'done' */
      phase: string
      /** 命令名称（可选）。 */
      name?: string
    }

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
