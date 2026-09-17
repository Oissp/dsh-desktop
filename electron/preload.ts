/**
 * electron/preload.ts —— 暴露安全的 IPC API 给 renderer。
 */
/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ArchivedSessionInfo, DshStatus, HarnessApi, IpcResult } from '../shared/types.js'

const call = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>

const api: HarnessApi = {
  getAppState: () => call('app:getState'),
  updateAppSettings: (patch: Partial<AppSettings>) => call('app:updateSettings', patch),
  getDshStatus: () => call('dsh:status'),
  ensureDsh: () => call('dsh:ensure'),
  restartDsh: () => call('dsh:restart'),
  restoreCheckpointAndRestart: () => call('dsh:restoreCheckpoint'),
  openConfigDir: () => call('dsh:openConfigDir'),

  createSession: (cwd?: string, agentPreset?: string) => call('session:create', cwd, agentPreset),
  listModels: () => call('model:list'),
  setApiKey: (key: string) => call('cred:setKey', key),
  testApiKey: (key: string) => call('cred:testKey', key),
  pickDirectory: () => call('dir:pick'),

  onDshStatus: (cb: (status: DshStatus) => void) => {
    const listener = (_e: unknown, status: DshStatus) => cb(status)
    ipcRenderer.on('dsh:status', listener)
    return () => ipcRenderer.removeListener('dsh:status', listener)
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
        // s.title 已是 ipc 合并后的（快照 + 本地元数据）；meta 只补 cwd/archivedAt
        return { sessionId: s.sessionId, title: s.title ?? m?.title, cwd: s.cwd ?? m?.cwd, archivedAt: m?.archivedAt }
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

// ---- 主题源转发 ----
// 官方 UI（0.1.6-alpha.2+）把当前主题源发布在 html[data-ds-theme-source] 上，
// 供宿主壳把原生窗口装饰对齐到应用主题。桌面壳把它转给主进程的
// nativeTheme.themeSource，macOS 标题栏/活力效果才会跟随应用主题而不是系统主题。
// 回退屏不发布该属性（自身硬编码深色），其窗口装饰由主进程在 loadFallback 时置 dark。
const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source'
const THEME_SOURCES = new Set(['light', 'dark', 'system'])

function forwardThemeSource(): void {
  const report = (): void => {
    const value = document.documentElement?.getAttribute(THEME_SOURCE_ATTRIBUTE)
    // 只放行已知取值：这条消息跨渲染进程边界，主进程不应接受任意字符串
    if (value !== null && value !== undefined && THEME_SOURCES.has(value)) {
      ipcRenderer.send('desktop:themeSource', value)
    }
  }
  const observe = (): void => {
    report()
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_SOURCE_ATTRIBUTE],
    })
  }
  if (document.documentElement) observe()
  else document.addEventListener('DOMContentLoaded', observe, { once: true })
}

forwardThemeSource()
