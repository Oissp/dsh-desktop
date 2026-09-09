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
  /** 在主窗口内打开归档会话只读视图（导航，非弹窗）。 */
  openArchiveViewer(sessionId: string, title?: string): Promise<void>
  /** 从归档视图返回官方引擎 UI。 */
  returnToEngine(): Promise<void>
  /** 归档会话列表（含本地缓存的标题/cwd 元数据合并，过滤复盘会话）。 */
  listArchived(): Promise<ArchivedSessionInfo[]>
  /** 彻底删除归档会话（先归档再清磁盘）。 */
  hardDeleteSession(sessionId: string, cwd?: string): Promise<boolean>
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
  openArchiveViewer: async (sessionId, title) => {
    await call('desktop:openArchiveViewer', sessionId, title)
  },
  returnToEngine: async () => {
    await call('desktop:returnToEngine')
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
    const reviewId = stateRes.ok ? stateRes.value?.reviewSessionId : undefined
    return (listRes.value ?? [])
      .filter((s) => s.sessionId !== reviewId)
      .map((s) => {
        const m = meta?.[s.sessionId]
        return { sessionId: s.sessionId, title: m?.title, cwd: s.cwd ?? m?.cwd, archivedAt: m?.archivedAt }
      })
  },
  hardDeleteSession: async (sessionId, cwd) => {
    const res = await call('session:hardDelete', sessionId, cwd)
    return res.ok
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

/**
 * 归档分组注入（官方 UI 页面）：官方 UI 无归档概念，桌面侧的归档会话
 * 在官方 UI 下无处可看（桌面 React 侧栏仅启动/回退屏可见）。这里在官方
 * 侧栏底部注入一个可折叠的"归档"分组，复用 __desktop__ 桥的归档 API。
 *
 * 点击归档条目 → 主窗口导航到归档只读视图（openArchiveViewer，非弹窗）；
 * 返回按钮 → returnToEngine 重新加载官方 UI。
 *
 * 定位策略：不依赖官方的 CSS Modules hash 类名（构建期变动），改用结构特征——
 * 找页面里最高最窄的垂直滚动容器（即会话列表侧栏），把面板插到其末尾。
 */
function injectArchivedPanel() {
  const PANEL_ATTR = 'data-hd-archived-panel'
  let collapsed = true
  let cache: ArchivedSessionInfo[] = []
  let pendingDelete: string | null = null

  /** 判断颜色主题：官方 UI 在 body 上标记深浅主题，无标记时按背景亮度推断。 */
  const isDark = () => !document.body?.hasAttribute('data-ds-light-theme') &&
    (document.body?.hasAttribute('data-ds-dark-theme') ||
      (() => {
        const s = document.body ? getComputedStyle(document.body).backgroundColor : ''
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
        if (!m) return true
        return Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114 <= 140
      })())

  const colors = () =>
    isDark()
      ? { fg: '#e8eaf1', dim: '#9aa3b2', border: 'rgb(255 255 255 / 12%)', hover: 'rgb(255 255 255 / 6%)', danger: '#ff6b6b' }
      : { fg: '#111418', dim: '#5a6472', border: 'rgb(0 0 0 / 10%)', hover: 'rgb(0 0 0 / 5%)', danger: '#d93a3a' }

  /**
   * 找官方侧栏容器：页面内可见、宽度 180–420px、高度占视口大半的垂直容器。
   * 取最深的匹配（最贴近列表本体），避免命中外层布局壳。
   */
  const findSidebar = (): HTMLElement | null => {
    const vh = window.innerHeight
    let best: HTMLElement | null = null
    let bestDepth = -1
    const all = document.body ? document.body.querySelectorAll('*') : []
    for (const el of Array.from(all) as HTMLElement[]) {
      const r = el.getBoundingClientRect()
      if (r.width < 180 || r.width > 420) continue
      if (r.height < vh * 0.5) continue
      if (r.left > 120) continue // 侧栏贴左
      let depth = 0
      for (let p = el.parentElement; p; p = p.parentElement) depth++
      if (depth > bestDepth) {
        best = el
        bestDepth = depth
      }
    }
    return best
  }

  const makeRow = (s: ArchivedSessionInfo): HTMLElement => {
    const c = colors()
    const row = document.createElement('div')
    row.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;font:400 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:' +
      c.dim + ';cursor:pointer'
    row.onmouseenter = () => (row.style.background = c.hover)
    row.onmouseleave = () => (row.style.background = 'transparent')
    row.onclick = () => {
      void desktop.openArchiveViewer(s.sessionId, s.title || undefined)
    }

    const title = document.createElement('span')
    title.textContent = s.title || '归档会话 ' + s.sessionId.slice(8, 14)
    title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    title.title = (s.title || s.sessionId) + (s.cwd ? '\n' + s.cwd : '') + '\n点击查看会话内容'
    row.appendChild(title)

    if (pendingDelete === s.sessionId) {
      const confirm = document.createElement('span')
      confirm.textContent = '确认删除？'
      confirm.style.cssText = 'font-size:11px;color:' + c.danger
      const yes = document.createElement('button')
      yes.textContent = '删除'
      yes.style.cssText =
        'background:none;border:none;cursor:pointer;font-size:11px;padding:1px 4px;color:' + c.danger
      yes.onclick = (e) => {
        e.stopPropagation()
        void desktop.hardDeleteSession(s.sessionId, s.cwd).then(() => {
          pendingDelete = null
          void refresh()
        })
      }
      const no = document.createElement('button')
      no.textContent = '取消'
      no.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;padding:1px 4px;color:' + c.dim
      no.onclick = (e) => {
        e.stopPropagation()
        pendingDelete = null
        render()
      }
      row.appendChild(confirm)
      row.appendChild(yes)
      row.appendChild(no)
    } else {
      const del = document.createElement('button')
      del.textContent = '✕'
      del.title = '彻底删除（含磁盘目录）'
      del.style.cssText =
        'background:none;border:none;cursor:pointer;font-size:11px;padding:1px 4px;opacity:.6;color:' + c.dim
      del.onclick = (e) => {
        e.stopPropagation()
        pendingDelete = s.sessionId
        render()
      }
      row.appendChild(del)
    }
    return row
  }

  /** 渲染面板内容到已挂载的容器（不重新定位）。 */
  const render = () => {
    const panel = document.querySelector('[' + PANEL_ATTR + ']') as HTMLElement | null
    if (!panel) return
    const c = colors()
    panel.innerHTML = ''
    if (cache.length === 0) return // 无归档会话：不占位

    const header = document.createElement('button')
    header.style.cssText =
      'display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;padding:6px 8px;font:500 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:' +
      c.dim
    header.title = collapsed ? '展开归档会话' : '收起归档会话'
    header.onclick = () => {
      collapsed = !collapsed
      pendingDelete = null
      render()
    }
    const caret = document.createElement('span')
    caret.textContent = collapsed ? '▸' : '▾'
    const label = document.createElement('span')
    label.textContent = '归档'
    label.style.flex = '1'
    label.style.textAlign = 'left'
    const count = document.createElement('span')
    count.textContent = String(cache.length)
    count.style.cssText = 'opacity:.7;font-variant-numeric:tabular-nums'
    header.appendChild(caret)
    header.appendChild(label)
    header.appendChild(count)
    panel.appendChild(header)

    if (!collapsed) {
      const list = document.createElement('div')
      list.style.cssText = 'display:flex;flex-direction:column;gap:1px;max-height:40vh;overflow-y:auto;padding-bottom:4px'
      for (const s of cache) list.appendChild(makeRow(s))
      panel.appendChild(list)
    }
  }

  /** 拉取归档列表并渲染。 */
  const refresh = async () => {
    cache = await desktop.listArchived()
    render()
  }

  /** 确保面板已挂载在侧栏末尾；侧栏容器变化或面板脱离时重新挂到当前最佳侧栏。 */
  const ensurePanel = () => {
    const sidebar = findSidebar()
    if (!sidebar) return
    const existing = document.querySelector('[' + PANEL_ATTR + ']') as HTMLElement | null
    // 已挂在正确的侧栏末尾：跳过。否则（首次、React 重渲染换掉旧容器、或初载命中了错误容器）
    // 一律（重新）追加到当前最佳侧栏末尾——appendChild 会先把已有节点从旧父级摘下再挂回。
    if (existing && existing.isConnected && existing.parentElement === sidebar && sidebar.lastElementChild === existing) return
    const c = colors()
    let panel = existing
    if (!panel || !panel.isConnected) {
      panel = document.createElement('div')
      panel.setAttribute(PANEL_ATTR, '1')
    }
    panel.style.cssText =
      'flex:0 0 auto;margin:4px 6px 6px;padding-top:6px;border-top:1px solid ' + c.border
    sidebar.appendChild(panel)
    render()
  }

  const boot = () => {
    void refresh()
    // 延迟初次挂载：等侧栏 DOM 稳定后再挂，避免页面加载早期 findSidebar 命中错误容器
    setTimeout(() => ensurePanel(), 500)
    setTimeout(() => ensurePanel(), 1500)
    // React 重渲染会移除注入节点 → MutationObserver 兜底重挂（节流）
    let lastScan = 0
    const mo = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastScan < 400) return
      lastScan = now
      ensurePanel()
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    // 归档集合变化（在官方 UI 里归档会话）无事件回流，定期轻量复查
    setInterval(() => void refresh(), 10_000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

injectArchivedPanel()