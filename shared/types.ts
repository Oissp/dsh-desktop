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

/** 模型目录（llm.models 的归一化视图）。 */
export interface ModelGroup {
  id: string
  name: string
  models: { id: string; name: string; description?: string }[]
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
