/**
 * electron/preload.ts —— 暴露安全的 IPC API 给 renderer。
 */
/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, DshStatus, HarnessApi, IpcResult } from '../shared/types.js'

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
