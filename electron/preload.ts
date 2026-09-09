/**
 * electron/preload.ts —— 暴露安全的 IPC API 给 renderer。
 */
/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ArchivedSessionInfo,
  CustomProviderConfig,
  DshStatus,
  HarnessApi,
  IpcResult,
  PickedFile,
  Reminder,
  SessionStreamEvent,
  WebSearchConfig,
} from '../shared/types.js'

const call = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>

const api: HarnessApi = {
  getAppState: () => call('app:getState'),
  updateAppSettings: (patch: Partial<AppSettings>) => call('app:updateSettings', patch),
  setAutoLaunch: (enabled: boolean) => call('app:setAutoLaunch', enabled),
  checkForUpdates: () => call('update:check'),
  quitAndInstall: () => call('update:quitAndInstall'),
  getDshStatus: () => call('dsh:status'),
  ensureDsh: () => call('dsh:ensure'),
  shutdownDsh: () => call('dsh:shutdown'),
  restartDsh: () => call('dsh:restart'),
  restoreCheckpointAndRestart: () => call('dsh:restoreCheckpoint'),
  openConfigDir: () => call('dsh:openConfigDir'),
  describe: () => call('dsh:describe'),

  listSessions: () => call('session:list'),
  createSession: (cwd?: string, agentPreset?: string) => call('session:create', cwd, agentPreset),
  getHistory: (sessionId: string) => call('session:history', sessionId),
  sendMessage: (sessionId: string, text: string, files?: PickedFile[]) => call('session:send', sessionId, text, files),
  cancelTurn: (sessionId: string) => call('session:cancel', sessionId),
  renameSession: (sessionId: string, title: string) => call('session:rename', sessionId, title),
  forkSession: (sessionId: string) => call('session:fork', sessionId),
  archiveSession: (sessionId: string) => call('session:archive', sessionId),
  hardDeleteSession: (sessionId: string, cwd?: string) => call('session:hardDelete', sessionId, cwd),
  listArchivedSessions: () => call('session:listArchived'),
  copyText: (text: string) => call('clipboard:copy', text),

  listAgentPresets: () => call('preset:list'),
  selectAgentPreset: (sessionId: string, agentPreset: string) => call('preset:select', sessionId, agentPreset),
  pickFiles: () => call('files:pick'),

  listModels: () => call('model:list'),
  listProviders: () => call('model:providers'),
  selectModel: (sessionId: string, provider: string, model: string) =>
    call('model:select', sessionId, provider, model),

  listCustomProviders: () => call('provider:list'),
  saveCustomProvider: (config: CustomProviderConfig) => call('provider:save', config),
  removeCustomProvider: (id: string) => call('provider:remove', id),
  setProviderApiKey: (apiKeyEnv: string, key: string) => call('provider:setKey', apiKeyEnv, key),

  setApiKey: (key: string) => call('cred:setKey', key),
  hasApiKey: () => call('cred:hasKey'),
  testApiKey: (key: string) => call('cred:testKey', key),
  pickDirectory: () => call('dir:pick'),

  listCredentials: () => call('cred:list'),
  setCredential: (ref: string, value: string) => call('cred:setRef', ref, value),
  clearCredential: (ref: string) => call('cred:clear', ref),
  listReminders: () => call('reminder:list'),
  createReminder: (input: Omit<Reminder, 'id' | 'nextAt'>) => call('reminder:create', input),
  deleteReminder: (id: string) => call('reminder:delete', id),
  togglePlanMode: (sessionId: string) => call('plan:toggle', sessionId),
  getWebSearchConfig: () => call('websearch:get'),
  setWebSearchConfig: (config: Partial<WebSearchConfig>) => call('websearch:set', config),
  exportSession: (sessionId: string, format: 'zip' | 'json' | 'markdown') => call('session:export', sessionId, format),
  listSkills: (sessionId: string) => call('skill:list', sessionId),

  onSessionEvent: (cb: (evt: SessionStreamEvent) => void) => {
    const listener = (_e: unknown, evt: SessionStreamEvent) => cb(evt)
    ipcRenderer.on('dsh:event', listener)
    void ipcRenderer.invoke('dsh:subscribe')
    return () => ipcRenderer.removeListener('dsh:event', listener)
  },
  onMenuEvent: (cb: (action: 'new-chat' | 'open-settings') => void) => {
    const onNew = () => cb('new-chat')
    const onSettings = () => cb('open-settings')
    ipcRenderer.on('menu:new-chat', onNew)
    ipcRenderer.on('menu:open-settings', onSettings)
    return () => {
      ipcRenderer.removeListener('menu:new-chat', onNew)
      ipcRenderer.removeListener('menu:open-settings', onSettings)
    }
  },
  onReminderFired: (cb: (payload: { sessionId: string; text: string }) => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; text: string }) => cb(payload)
    ipcRenderer.on('reminder:fired', listener)
    return () => ipcRenderer.removeListener('reminder:fired', listener)
  },
  onDshStatus: (cb: (status: DshStatus) => void) => {
    const listener = (_e: unknown, status: DshStatus) => cb(status)
    ipcRenderer.on('dsh:status', listener)
    return () => ipcRenderer.removeListener('dsh:status', listener)
  },
  onUpdateStatus: (cb: (status: { state: string; version?: string; percent?: number; message?: string }) => void) => {
    const listener = (_e: unknown, status: { state: string; version?: string; percent?: number; message?: string }) =>
      cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
}

contextBridge.exposeInMainWorld('harness', api)

// ---- 026 __desktop__ 桥：官方 UI 页面消费的桌面壳能力 ----
interface DesktopBridge {
  getPort(): Promise<number | null>
  getVersion(): Promise<string>
  notify(title: string, body: string): Promise<void>
  /** 归档会话列表（含本地缓存的标题/cwd 元数据合并）。 */
  listArchived(): Promise<ArchivedSessionInfo[]>
  /** 彻底删除归档会话（先归档再清磁盘）。 */
  hardDeleteSession(sessionId: string, cwd?: string): Promise<boolean>
  /** 归档会话历史（只读查看用）；失败返回 null。 */
  getHistory(sessionId: string): Promise<{ events: unknown[]; hasMore: boolean } | null>
  onEnginePort(cb: (port: number | null) => void): () => void
  onMenuEvent(cb: (action: 'new-chat' | 'open-settings') => void): () => void
}

const desktop: DesktopBridge = {
  getPort: async () => {
    const res = await call<number | null>('desktop:getPort')
    return res.ok ? (res.value ?? null) : null
  },
  getVersion: async () => {
    const res = await call<string>('desktop:getVersion')
    return res.ok ? (res.value ?? '') : ''
  },
  notify: async (title, body) => {
    await call('desktop:notify', title, body)
  },
  // 归档列表：dsh baseline 只给 sessionId + cwd，标题归档后无处可查，
  // 故与桌面侧本地缓存的 archivedSessionMeta 合并（与桌面 UI 同一套数据）。
  listArchived: async () => {
    const [listRes, stateRes] = await Promise.all([
      call<ArchivedSessionInfo[]>('session:listArchived'),
      call<AppSettings>('app:getState'),
    ])
    if (!listRes.ok) return []
    const meta = stateRes.ok ? stateRes.value?.archivedSessionMeta : undefined
    return (listRes.value ?? [])
      .map((s) => {
        const m = meta?.[s.sessionId]
        return { sessionId: s.sessionId, title: m?.title, cwd: s.cwd ?? m?.cwd, archivedAt: m?.archivedAt }
      })
  },
  hardDeleteSession: async (sessionId, cwd) => {
    const res = await call('session:hardDelete', sessionId, cwd)
    return res.ok
  },
  getHistory: async (sessionId) => {
    const res = await call<{ events: unknown[]; hasMore: boolean }>('session:history', sessionId)
    return res.ok ? (res.value ?? null) : null
  },
  onEnginePort: (cb) => {
    const listener = (_e: unknown, status: DshStatus) => {
      cb(status?.port ?? null)
    }
    ipcRenderer.on('dsh:status', listener)
    return () => ipcRenderer.removeListener('dsh:status', listener)
  },
  onMenuEvent: (cb) => {
    const onNew = () => cb('new-chat')
    const onSettings = () => cb('open-settings')
    ipcRenderer.on('menu:new-chat', onNew)
    ipcRenderer.on('menu:open-settings', onSettings)
    return () => {
      ipcRenderer.removeListener('menu:new-chat', onNew)
      ipcRenderer.removeListener('menu:open-settings', onSettings)
    }
  },
}

contextBridge.exposeInMainWorld('__desktop__', desktop)
