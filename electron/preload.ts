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
  UsageData,
  UsageDay,
  WorkspaceFileNode,
  SessionStreamEvent,
  WebSearchConfig,
} from '../shared/types.js'
import { dayKey, fmt, recentUsageDays, summarizeUsage } from '../shared/usage-format.js'

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
  listMemories: () => call('memory:list'),
  addMemory: (text: string, tags?: string[]) => call('memory:add', text, tags),
  deleteMemory: (id: string) => call('memory:delete', id),
  clearMemories: () => call('memory:clear'),
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
  /** 硬删除会话（连同磁盘目录）。 */
  hardDeleteSession(sessionId: string, cwd?: string): Promise<boolean>
  /** 在只读窗口打开归档会话，查看其历史内容。 */
  openArchiveViewer(sessionId: string, title?: string): Promise<void>
  /** workspace 插件：列出工作区文件树。 */
  listWorkspace(
    cwd: string,
    opts?: { maxDepth?: number; limit?: number },
  ): Promise<WorkspaceFileNode[]>
  /** workspace 插件：读取工作区文件内容（限大小/限根目录内）。 */
  readWorkspaceFile(cwd: string, filePath: string): Promise<{ content: string; truncated: boolean; size: number } | null>
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
  openArchiveViewer: async (sessionId, title) => {
    await call('desktop:openArchiveViewer', sessionId, title)
  },
  listWorkspace: async (cwd, opts) => {
    const res = await call<WorkspaceFileNode[]>('desktop:listWorkspace', cwd, opts)
    return res.ok ? res.value! : []
  },
  readWorkspaceFile: async (cwd, filePath) => {
    const res = await call<{ content: string; truncated: boolean; size: number }>(
      'desktop:readWorkspaceFile',
      cwd,
      filePath,
    )
    return res.ok ? res.value! : null
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

// ---- 品牌注入（官方 UI 页面）：渐变流动鲸鱼 + "dsh desktop vX" ----
// 目标区域：① 窗口右上角（fixed 定位，任何页面可见）
//          ② 首次会话 hero（替换官方"探索未至之境 预览版"区）
// 动态变色 = SMIL 渐变 stop 颜色/位置循环（蓝→紫→粉），纯浏览器动画，无 JS 定时器
const BRAND_WHALE_PATH =
  'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

/** 渐变流动鲸鱼 SVG（SMIL 动画：stop 颜色 + 位置循环 蓝→紫→粉）。 */
function brandWhaleSvg(size: number, gradId: string): string {
  return (
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 50 50" fill="none" aria-hidden="true">' +
    '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%">' +
    '<animate attributeName="stop-color" values="#4f8cff;#a855f7;#ec4899;#4f8cff" dur="6s" repeatCount="indefinite"/>' +
    '<animate attributeName="offset" values="0%;0.5;0.95;0%" dur="6s" repeatCount="indefinite"/>' +
    '</stop>' +
    '<stop offset="50%"><animate attributeName="stop-color" values="#a855f7;#ec4899;#4f8cff;#a855f7" dur="6s" repeatCount="indefinite"/></stop>' +
    '<stop offset="100%"><animate attributeName="stop-color" values="#ec4899;#4f8cff;#a855f7;#ec4899" dur="6s" repeatCount="indefinite"/></stop>' +
    '</linearGradient></defs>' +
    '<path d="' + BRAND_WHALE_PATH + '" fill="url(#' + gradId + ')"/></svg>'
  )
}

// ---- 折叠工具条图标：与 src/components/icons.tsx 的线性图标集保持一致 ----
// （React 组件无法跨 bundle 直接复用到 preload 的原生 DOM 注入代码里，这里照抄其
//  SVG path，保证视觉一致：24 视口、currentColor 描边、1.7 线宽、圆头圆角。）
function iconSvg(size: number, content: string): string {
  return (
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + content + '</svg>'
  )
}

/** IconPanel：侧边栏面板，collapsed 决定箭头朝向。 */
function iconPanelSvg(size: number, collapsed: boolean): string {
  const arrow = collapsed ? '<path d="M13.5 9.5L16 12l-2.5 2.5"/>' : '<path d="M16 9.5L13.5 12l2.5 2.5"/>'
  return iconSvg(size, '<rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="9.5" y1="4" x2="9.5" y2="20"/>' + arrow)
}

/** IconSearch。 */
function iconSearchSvg(size: number): string {
  return iconSvg(size, '<circle cx="11" cy="11" r="6.5"/><line x1="15.8" y1="15.8" x2="20" y2="20"/>')
}

/** IconPlus。 */
function iconPlusSvg(size: number): string {
  return iconSvg(size, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')
}

/** 品牌注入（官方 UI 页面）：左上角品牌替换 + 首次会话 hero 替换。 */
function injectDesktopBrand() {
  const started = Date.now()

  /**
   * 动态解析品牌文字颜色：读取侧栏/文档背景亮度。
   * 浅色主题（背景亮）→ 深色文字（黑）；深色主题 → 浅色文字（白），保证反差。
   */
  const resolveBrandColors = (): { primary: string; secondary: string } => {
    const bg = (() => {
      const sidebar = document.querySelector('[class*="sidebarCol"], [class*="sidebar"]')
      const probe = sidebar ?? document.body
      if (!probe) return '#0f1115'
      const style = getComputedStyle(probe)
      const rgb = style.backgroundColor
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb)
      if (m) {
        const lum = (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114)
        return lum > 140 ? 'light' : 'dark'
      }
      return 'dark'
    })()
    if (bg === 'light') return { primary: '#111418', secondary: '#5a6472' }
    return { primary: '#e8eaf1', secondary: '#9aa3b2' }
  }

  /** hero 版本徽标：浅色界面蓝底白字；深色界面白底深字（反差）。 */
  const heroVersionBadge = (): { style: string; dataAttr: string } => {
    const { primary } = resolveBrandColors()
    const isLight = primary === '#111418'
    const badgeStyle = isLight
      ? 'display:inline-block;margin-left:10px;background:#4f8cff;color:#fff;font:600 13px/1.4 -apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif;border-radius:999px;padding:3px 10px;vertical-align:middle;'
      : 'display:inline-block;margin-left:10px;background:#fff;color:#111418;font:600 13px/1.4 -apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif;border-radius:999px;padding:3px 10px;vertical-align:middle;'
    return { style: badgeStyle, dataAttr: 'data-hd-hero-ver' }
  }

  /** hero 品牌：居中排版（大鲸鱼 + 标题 + 版本徽标 + 副标题）。 */
  const makeHeroBrand = (): HTMLElement => {
    const { primary, secondary } = resolveBrandColors()
    const ver = heroVersionBadge()
    const el = document.createElement('div')
    el.setAttribute('data-hd-hero-brand', '1')
    el.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:12px 0;width:100%;'
    el.innerHTML =
      brandWhaleSvg(56, 'hd-hero-grad') +
      '<span data-hd-hero-title style="font:700 30px/1.2 -apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif;color:' +
      primary +
      ';letter-spacing:.3px">DSH Desktop <span ' +
      ver.dataAttr +
      ' style="' +
      ver.style +
      '>v1.0.1</span></span>' +
      '<span data-hd-hero-sub style="font:400 14px/1.5 -apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif;color:' +
      secondary +
      '">你的 AI 工作台 · 开始对话</span>'
    return el
  }

  const applyVersion = () => {
    // hero 版本徽标用 getVersion 填充（默认 v1.0.1）
    void desktop.getVersion().then((v) => {
      const heroVer = document.querySelector('[data-hd-hero-ver]')
      if (heroVer) heroVer.textContent = 'v' + (v || '1.0.1')
    })
  }

  /** hero 品牌替换的目标文本（多语言兜底：中文/英文/未就绪的 key）。 */
  const HERO_HEADLINE_KEYS = ['探索未至', 'Into the Unknown', 'hero.headline']

  /**
   * 找官方 hero 的 .headline 容器并替换为品牌。
   * 三层匹配：
   *  C) CSS Modules 结构：`[class*="_headline_"]`（原类名保留在 hash 中，不依赖 locale）
   *  B) 文本匹配：中文/英文/未就绪 key
   *  校验父级含 fish 特征（子元素有 svg），避免误替换。
   */
  const ensureHero = () => {
    if (!document.body) return
    // 已注入标记：跳过
    if (document.querySelector('[data-hd-hero-brand]')) return
    // 方案 C：结构匹配 headline 容器 → 取祖先 stack（更宽、CSS 居中，品牌 column 排版自然生效）
    const headlineEls = Array.from(document.querySelectorAll('[class*="_headline_"]'))
    for (const headline of headlineEls) {
      const text = (headline.textContent ?? '').trim()
      const hasHeroText = HERO_HEADLINE_KEYS.some((k) => text.indexOf(k) !== -1)
      const hasFish = headline.querySelector('svg') !== null || headline.closest('[class*="_fish_"]') !== null
      if (hasHeroText || hasFish) {
        // 用 headline 的父 stack 容器（headline.parentElement 即 stack，宽、CSS 居中）
        // 避免 closest 匹配到 headline 自身（若其 class 意外含 _stack_）
        let target: HTMLElement | null = headline.parentElement
        if (target && target !== headline && target.classList) {
          // 确认 target 是 stack 或更宽容器
          if (target.querySelector && !target.querySelector('[data-hd-hero-brand]')) {
            target.innerHTML = ''
            target.appendChild(makeHeroBrand())
            applyVersion()
            return
          }
        }
      }
    }
    // 方案 B：文本匹配（兜底，用于结构类名变动时）
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent ?? ''
      if (HERO_HEADLINE_KEYS.some((k) => text.indexOf(k) !== -1)) {
        const textEl = node.parentElement
        const headline = textEl ? textEl.parentElement : null
        if (headline && headline.parentElement && !headline.querySelector('[data-hd-hero-brand]')) {
          const target = headline.parentElement
          if (target && !target.querySelector('[data-hd-hero-brand]')) {
            target.innerHTML = ''
            target.appendChild(makeHeroBrand())
            applyVersion()
            return
          }
        }
      }
    }
  }

  const boot = () => {
    ensureHero()
    // React 重渲染可能恢复官方 hero → MutationObserver 持续兜底重注入（节流）
    // characterData: true —— locale 就绪后 hero 文本从 key/英文变中文是 characterData 变更
    let lastScan = 0
    const mo = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastScan < 300) return
      lastScan = now
      ensureHero()
    })
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    // 兜底轮询：hero 延迟渲染时也能命中（30s 后停止）
    const poll = () => {
      if (Date.now() - started > 30000) return
      ensureHero()
      setTimeout(poll, 400)
    }
    setTimeout(poll, 400)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

/**
 * 归档分组注入（官方 UI 页面）：官方 UI 无归档概念，桌面侧的归档会话
 * 在官方 UI 下无处可看（桌面 React 侧栏仅启动/回退屏可见）。这里在官方
 * 侧栏底部注入一个可折叠的"归档"分组，复用 __desktop__ 桥的归档 API。
 *
 * 定位策略：不依赖官方的 CSS Modules hash 类名（构建期变动），改用结构特征——
 * 找页面里最高最窄的垂直滚动容器（即会话列表侧栏），把面板插到其末尾。
 */
function injectArchivedPanel() {
  const PANEL_ATTR = 'data-hd-archived-panel'
  let collapsed = true
  let cache: ArchivedSessionInfo[] = []
  let pendingDelete: string | null = null

  /** 判断颜色主题（与品牌注入同一套亮度探测）。 */
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
    // 诊断：侧栏探测与挂载结果。findSidebar 是结构启发式（官方 UI 类名为构建期
    // hash，不可依赖），上游改版可能致探测失败 —— 排查时开 DevTools 看这行。
    if (process.env.HD_ARCHIVED_DEBUG) {
      const report = () => {
        const sb = findSidebar()
        const r = sb ? sb.getBoundingClientRect() : null
        console.log(
          '[hd-archived] sidebar=' +
            (sb
              ? sb.tagName + '.' + String(sb.className).slice(0, 60) + ' ' + Math.round(r!.width) + 'x' + Math.round(r!.height) + ' @left=' + Math.round(r!.left)
              : 'NOT_FOUND') +
            ' mounted=' + Boolean(document.querySelector('[' + PANEL_ATTR + ']')?.isConnected) +
            ' archived=' + cache.length,
        )
      }
      setTimeout(report, 3000)
      setTimeout(report, 8000)
    }
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
    // 暴露刷新接口：归档窗口关闭时触发立即刷新（标题回写后更新列表显示）
    ;(window as { __hd_refreshArchived?: () => Promise<void> }).__hd_refreshArchived = refresh
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

/**
 * 用量面板注入（官方 UI 页面）：官方 UI 无用量统计概念，桌面侧的 usage 插件
 * 只在本地 SPA 可见（不会显示在真机日常使用的官方引擎页面）。这里在官方
 * 侧栏底部（归档面板之上）注入一个可折叠的"用量"分组：概览统计卡片 +
 * 最近 7 天柱状条 + 范围选择（今日/本周/本月/全部）。
 *
 * 数据源：直接订阅 `api.onSessionEvent`（同一份会话事件流，本地 SPA 和官方
 * 页面共享），在 preload 模块作用域内复刻 UsageStore.handleEvent() 的累计
 * 逻辑，持久化走 `api.updateAppSettings({ usage })`（与 UsageStore 同一个
 * AppSettings.usage 字段，两边数据互通、不冲突）。
 */
function injectUsagePanel() {
  const PANEL_ATTR = 'data-hd-usage-panel'
  const MAX_DAYS = 90
  let collapsed = true
  let data: UsageData = { days: {} }
  type Range = 'today' | 'week' | 'month' | 'all'
  let range: Range = 'month'
  const RANGES: { key: Range; label: string }[] = [
    { key: 'today', label: '今日' },
    { key: 'week', label: '本周' },
    { key: 'month', label: '本月' },
    { key: 'all', label: '全部' },
  ]

  /** 判断颜色主题（与品牌/归档注入同一套亮度探测）。 */
  const isDark = () =>
    !document.body?.hasAttribute('data-ds-light-theme') &&
    (document.body?.hasAttribute('data-ds-dark-theme') ||
      (() => {
        const s = document.body ? getComputedStyle(document.body).backgroundColor : ''
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
        if (!m) return true
        return Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114 <= 140
      })())

  const colors = () =>
    isDark()
      ? { fg: '#e8eaf1', dim: '#9aa3b2', border: 'rgb(255 255 255 / 12%)', hover: 'rgb(255 255 255 / 6%)' }
      : { fg: '#111418', dim: '#5a6472', border: 'rgb(0 0 0 / 10%)', hover: 'rgb(0 0 0 / 5%)' }

  /**
   * 找官方侧栏容器：页面内可见、宽度 180–420px、高度占视口大半的垂直容器。
   * 与 injectArchivedPanel 同一套结构启发式（官方 CSS Modules 类名为构建期
   * hash，不可依赖）。
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

  /** 逐日淘汰超过 MAX_DAYS 的旧数据（与 UsageStore.prune 同逻辑）。 */
  const prune = () => {
    const keys = Object.keys(data.days).sort()
    while (keys.length > MAX_DAYS) {
      delete data.days[keys.shift()!]
    }
  }

  /** 复刻 UsageStore.handleEvent()：从会话事件流累计 token/回合/工具调用。 */
  const handleEvent = (evt: SessionStreamEvent) => {
    const day = dayKey()
    const cur = data.days[day] ?? {
      date: day,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      turns: 0,
      tools: 0,
    }
    let changed = false

    if (evt.kind === 'turn-end') {
      const u = evt.usage
      const pick = (v: number | undefined): number => (v ? Math.max(0, Math.round(v)) : 0)
      const inT = pick(u?.inputTokens)
      const outT = pick(u?.outputTokens)
      const cacheRead = pick(u?.cacheReadTokens)
      const cacheWrite = pick(u?.cacheWriteTokens)
      const reasoning = pick(u?.reasoningTokens)
      if (inT > 0 || outT > 0 || cacheRead > 0 || cacheWrite > 0 || reasoning > 0) {
        cur.inputTokens += inT
        cur.outputTokens += outT
        cur.cacheReadTokens += cacheRead
        cur.cacheWriteTokens += cacheWrite
        cur.reasoningTokens += reasoning
        changed = true
      }
      cur.turns += 1
      changed = true
    } else if (evt.kind === 'tool-call') {
      cur.tools += 1
      changed = true
    }

    if (changed) {
      data.days[day] = cur
      prune()
      void api.updateAppSettings({ usage: data })
      render()
    }
  }

  /** 渲染面板内容到已挂载的容器（不重新定位）。 */
  const render = () => {
    const panel = document.querySelector('[' + PANEL_ATTR + ']') as HTMLElement | null
    if (!panel) return
    const c = colors()
    panel.innerHTML = ''

    const summary = summarizeUsage(data)

    const header = document.createElement('button')
    header.style.cssText =
      'display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;padding:6px 8px;font:500 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:' +
      c.dim
    header.title = collapsed ? '展开用量统计' : '收起用量统计'
    header.onclick = () => {
      collapsed = !collapsed
      render()
    }
    const caret = document.createElement('span')
    caret.textContent = collapsed ? '▸' : '▾'
    const label = document.createElement('span')
    label.textContent = '用量'
    label.style.flex = '1'
    label.style.textAlign = 'left'
    const totalBadge = document.createElement('span')
    totalBadge.textContent = fmt(
      summary.total.inputTokens + summary.total.outputTokens + summary.total.cacheReadTokens + summary.total.cacheWriteTokens,
    )
    totalBadge.style.cssText = 'opacity:.7;font-variant-numeric:tabular-nums'
    header.appendChild(caret)
    header.appendChild(label)
    header.appendChild(totalBadge)
    panel.appendChild(header)

    if (!collapsed) {
      const body = document.createElement('div')
      body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:2px 8px 10px'

      // 范围选择：今日/本周/本月/全部
      const rangeRow = document.createElement('div')
      rangeRow.style.cssText = 'display:flex;gap:4px'
      for (const r of RANGES) {
        const b = document.createElement('button')
        b.textContent = r.label
        const active = range === r.key
        b.style.cssText =
          'flex:1;padding:3px 0;border-radius:5px;border:1px solid ' +
          (active ? c.border : 'transparent') +
          ';background:' + (active ? c.hover : 'transparent') + ';color:' + (active ? c.fg : c.dim) +
          ';font:500 11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer'
        b.onclick = () => {
          range = r.key
          render()
        }
        rangeRow.appendChild(b)
      }
      body.appendChild(rangeRow)

      // 概览卡片：总 Token / 输入 / 输出 / 缓存读取 / 回合数 / 工具调用
      const cur: UsageDay =
        range === 'today' ? summary.today : range === 'week' ? summary.week : range === 'month' ? summary.month : summary.total
      const stats: { label: string; value: string }[] = [
        {
          label: '总 Token',
          value: fmt(cur.inputTokens + cur.outputTokens + cur.cacheReadTokens + cur.cacheWriteTokens),
        },
        { label: '输入 Token', value: fmt(cur.inputTokens) },
        { label: '输出 Token', value: fmt(cur.outputTokens) },
        { label: '缓存读取', value: fmt(cur.cacheReadTokens) },
        { label: '回合数', value: String(cur.turns) },
        { label: '工具调用', value: String(cur.tools) },
      ]
      const grid = document.createElement('div')
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px'
      for (const s of stats) {
        const card = document.createElement('div')
        card.style.cssText =
          'padding:6px 8px;border-radius:6px;background:' + c.hover + ';display:flex;flex-direction:column;gap:2px'
        const val = document.createElement('div')
        val.textContent = s.value
        val.style.cssText = 'font:600 14px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.fg
        const lab = document.createElement('div')
        lab.textContent = s.label
        lab.style.cssText = 'font:400 10px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.dim
        card.appendChild(val)
        card.appendChild(lab)
        grid.appendChild(card)
      }
      body.appendChild(grid)

      // 最近 7 天柱状条（简化版：输出/输入两段堆叠，缓存读取计入高度但不单独着色）
      const chartLabel = document.createElement('div')
      chartLabel.textContent = '最近 7 天'
      chartLabel.style.cssText =
        'font:500 11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.dim + ';margin-top:2px'
      body.appendChild(chartLabel)

      const days = recentUsageDays(data, 7)
      const maxTotal = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens + d.cacheReadTokens))
      const chart = document.createElement('div')
      chart.style.cssText = 'display:flex;align-items:flex-end;gap:4px;height:64px'
      for (const d of days) {
        const total = d.inputTokens + d.outputTokens + d.cacheReadTokens
        const h = total ? Math.max(4, Math.round((total / maxTotal) * 48)) : 2
        const col = document.createElement('div')
        col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:2px'
        col.title =
          d.date + '：输出 ' + fmt(d.outputTokens) + ' / 输入 ' + fmt(d.inputTokens) + ' / 缓存读 ' + fmt(d.cacheReadTokens)
        const track = document.createElement('div')
        track.style.cssText = 'width:100%;height:48px;display:flex;align-items:flex-end;justify-content:center'
        const bar = document.createElement('div')
        bar.style.cssText =
          'width:70%;height:' + h + 'px;border-radius:3px 3px 0 0;overflow:hidden;display:flex;flex-direction:column;background:' +
          c.border
        if (total > 0) {
          const outPart = document.createElement('div')
          outPart.style.cssText = 'width:100%;height:' + ((d.outputTokens / total) * 100).toFixed(2) + '%;background:#4f8cff'
          const inPart = document.createElement('div')
          inPart.style.cssText = 'width:100%;height:' + ((d.inputTokens / total) * 100).toFixed(2) + '%;background:#a855f7'
          bar.appendChild(outPart)
          bar.appendChild(inPart)
        }
        track.appendChild(bar)
        const dateLabel = document.createElement('span')
        dateLabel.textContent = d.date.slice(5)
        dateLabel.style.cssText = 'font:400 9px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.dim
        col.appendChild(track)
        col.appendChild(dateLabel)
        chart.appendChild(col)
      }
      body.appendChild(chart)

      panel.appendChild(body)
    }
  }

  /** 从持久化数据加载（AppSettings.usage）。 */
  const load = async () => {
    const res = await api.getAppState()
    if (res.ok && res.value?.usage) {
      data = { days: { ...(res.value.usage.days ?? {}) } }
      prune()
    }
    render()
  }

  /**
   * 确保面板已挂载：优先插在归档面板（若存在）之前，否则挂到侧栏末尾。
   * 与 injectArchivedPanel 的 ensurePanel 同一套"检测位置是否正确 → 不对就
   * （重新）挂载"策略，appendChild/insertBefore 会自动把已有节点从旧父级摘下。
   */
  const ensurePanel = () => {
    const sidebar = findSidebar()
    if (!sidebar) return
    const existing = document.querySelector('[' + PANEL_ATTR + ']') as HTMLElement | null
    const archived = document.querySelector('[data-hd-archived-panel]') as HTMLElement | null
    const archivedMounted = archived && archived.isConnected && archived.parentElement === sidebar
    const positioned =
      existing &&
      existing.isConnected &&
      existing.parentElement === sidebar &&
      (archivedMounted ? existing.nextElementSibling === archived : sidebar.lastElementChild === existing)
    if (positioned) return
    const c = colors()
    let panel = existing
    if (!panel || !panel.isConnected) {
      panel = document.createElement('div')
      panel.setAttribute(PANEL_ATTR, '1')
    }
    panel.style.cssText = 'flex:0 0 auto;margin:4px 6px 6px;padding-top:6px;border-top:1px solid ' + c.border
    if (archivedMounted) {
      sidebar.insertBefore(panel, archived)
    } else {
      sidebar.appendChild(panel)
    }
    render()
  }

  const boot = () => {
    void load()
    api.onSessionEvent(handleEvent)
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

/**
 * 布局注入（官方 UI 页面）：侧边栏全折叠 + 折叠后顶部工具条。
 *
 * 官方 UI 自带的折叠（品牌行 ☰）只把侧边栏缩到 56px 图标栏（rail）。这里在
 * 检测到 rail 态后把侧边栏完全隐藏、主区占满，并在顶部注入一条工具条：
 *   ☰ 展开侧边栏 —— 点官方折叠按钮复原
 *   搜索          —— 展开并聚焦官方搜索框（工作区标签旁）
 *   新会话        —— 点官方新会话按钮
 * 三个操作都复用官方原生控件，不重复造按钮。
 */
function injectDesktopLayout() {
  const TOOLBAR_ATTR = 'data-hd-layout-toolbar'

  /** 主题探测：与品牌/归档注入同一套亮度启发式。 */
  const isDark = () =>
    !document.body?.hasAttribute('data-ds-light-theme') &&
    (document.body?.hasAttribute('data-ds-dark-theme') ||
      (() => {
        const s = document.body ? getComputedStyle(document.body).backgroundColor : ''
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
        if (!m) return true
        return Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114 <= 140
      })())

  const colors = () =>
    isDark()
      ? { bg: 'rgb(15,17,21)', fg: '#e8eaf1', border: 'rgb(255 255 255 / 10%)', hover: 'rgb(255 255 255 / 8%)' }
      : { bg: '#f7f8fa', fg: '#111418', border: 'rgb(0 0 0 / 8%)', hover: 'rgb(0 0 0 / 6%)' }

  /** 官方布局网格第一列 = 侧边栏（class 含 "sidebarCol"，与品牌注入同模式）。 */
  const sidebar = (): HTMLElement | null =>
    document.querySelector('[class*="sidebarCol"]') as HTMLElement | null
  /** 官方布局网格容器（侧边栏的直接父级，grid-template-columns 三列）。 */
  const frame = (): HTMLElement | null => {
    const s = sidebar()
    return s ? (s.parentElement as HTMLElement) : null
  }
  /** 侧边栏右侧拖拽手柄（拖动改宽度，全折叠后应隐藏避免悬在主区上）。 */
  const resizeHandle = (): HTMLElement | null => {
    const f = frame()
    if (!f) return null
    for (const c of Array.from(f.children) as HTMLElement[]) {
      if (c.className && String(c.className).includes('handle')) return c
    }
    return null
  }
  /** 官方折叠按钮（品牌行 ☰，rail/展开两态都在）。 */
  const toggleBtn = (): HTMLElement | null => {
    const s = sidebar()
    return s ? (s.querySelector('button[class*="_toggle"]') as HTMLElement | null) : null
  }
  /** 官方新会话按钮。 */
  const newSessionBtn = (): HTMLElement | null => {
    const s = sidebar()
    return s ? (s.querySelector('[class*="_newSession"]') as HTMLElement | null) : null
  }
  /** 官方搜索按钮（工作区标签旁；点击展开搜索输入框并聚焦）。 */
  const searchBtn = (): HTMLElement | null =>
    document.querySelector('button[class*="_searchButton"]') as HTMLElement | null

  /**
   * rail（56px）/ 全隐藏态。判定不能靠宽度测量：折叠/展开走 grid 过渡动画，
   * 中途测量会竞态——React 展开时刚把 grid 恢复成 280px，我们却在过渡中读到
   * <100px 误判为折叠，又把 grid 归零卡死。改用官方折叠按钮的 aria-label
   * （折叠态=“打开侧边栏 / Open sidebar”，展开态=“收起侧边栏 / Collapse sidebar”）。
   */
  const isCollapsed = (): boolean => {
    const b = toggleBtn()
    if (b) {
      const label = (b.getAttribute('aria-label') || '').trim()
      if (label) return /打开|open/i.test(label)
    }
    const s = sidebar()
    return s ? s.getBoundingClientRect().width < 100 : false
  }

  let toolbar: HTMLElement | null = null

  /** 创建（或复用已注入的）顶部工具条，返回挂载后的节点。 */
  const ensureToolbar = (): HTMLElement => {
    let tb = document.querySelector('[' + TOOLBAR_ATTR + ']') as HTMLElement | null
    if (tb && tb.isConnected) return tb
    const c = colors()
    tb = document.createElement('div')
    tb.setAttribute(TOOLBAR_ATTR, '1')
    tb.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:44px;display:none;align-items:center;gap:4px;' +
      'padding:0 10px;background:' + c.bg + ';border-bottom:1px solid ' + c.border + ';' +
      'z-index:9999;user-select:none'
    /** label 以 '<' 开头时视为 innerHTML（SVG 图标），否则按纯文本处理。 */
    const mk = (label: string, title: string, on: () => void, primary = false): HTMLElement => {
      const b = document.createElement('button')
      if (label.startsWith('<')) {
        b.innerHTML = label
      } else {
        b.textContent = label
      }
      b.title = title
      b.style.cssText =
        'height:30px;padding:0 12px;border-radius:6px;border:1px solid transparent;cursor:pointer;' +
        'display:inline-flex;align-items:center;justify-content:center;gap:6px;' +
        'font:500 13px/1 -apple-system,"Segoe UI",Roboto,sans-serif;' +
        'background:' + (primary ? '#4f8cff' : 'transparent') + ';color:' + (primary ? '#fff' : c.fg) + ';' +
        'transition:background .15s,border-color .15s'
      b.onmouseenter = () => {
        if (!primary) b.style.background = c.hover
      }
      b.onmouseleave = () => {
        if (!primary) b.style.background = 'transparent'
      }
      b.onclick = on
      return b
    }
    tb.appendChild(mk(iconPanelSvg(17, true), '展开侧边栏', () => toggleBtn()?.click()))
    // 搜索入口：仿输入框样式（参照本地 SPA .cb-search 设计），点击仍转发触发官方搜索
    const searchEntry = document.createElement('button')
    searchEntry.title = '搜索会话 (⌘K)'
    searchEntry.style.cssText =
      'flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:30px;padding:0 8px 0 10px;' +
      'background:' + (isDark() ? 'rgb(255 255 255 / 6%)' : 'rgb(0 0 0 / 4%)') + ';border:1px solid ' + c.border + ';' +
      'border-radius:6px;color:' + c.fg + ';font:13px/1 -apple-system,"Segoe UI",Roboto,sans-serif;' +
      'text-align:left;cursor:pointer;transition:border-color .15s,background .15s'
    searchEntry.innerHTML =
      '<span style="flex-shrink:0;display:inline-flex;opacity:.7">' + iconSearchSvg(14) + '</span>' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.7">搜索会话…</span>' +
      '<kbd style="flex-shrink:0;padding:1px 5px;background:' + c.hover + ';border:1px solid ' + c.border + ';' +
      'border-radius:4px;font-family:ui-monospace,monospace;font-size:10px;opacity:.7">⌘K</kbd>'
    searchEntry.onmouseenter = () => {
      searchEntry.style.background = c.hover
    }
    searchEntry.onmouseleave = () => {
      searchEntry.style.background = isDark() ? 'rgb(255 255 255 / 6%)' : 'rgb(0 0 0 / 4%)'
    }
    searchEntry.onclick = () => {
      const toggle = toggleBtn()
      const search = searchBtn()
      if (toggle) toggle.click()
      if (search) setTimeout(() => search.click(), 150)
    }
    tb.appendChild(searchEntry)
    tb.appendChild(mk(iconPlusSvg(17) + '<span>新会话</span>', '新建会话', () => newSessionBtn()?.click(), true))
    document.body.appendChild(tb)
    return tb
  }

  /** 应用当前布局状态：折叠 → 全隐藏侧栏 + 显示工具条；展开 → 还原。 */
  const apply = (): void => {
    const s = sidebar()
    const f = frame()
    const h = resizeHandle()
    const collapsed = isCollapsed()
    toolbar = ensureToolbar()
    if (collapsed) {
      // 把官方 rail（56px 列）清零、侧栏宽度归零（保留在网格流内，避免 display:none
      // 触发网格自动重排把主区挤掉）；DOM 保留，官方按钮仍可 .click()。
      if (f) f.style.gridTemplateColumns = '0 minmax(0, 1fr) 0'
      if (s) s.style.width = '0'
      if (h) h.style.display = 'none'
      document.body.classList.add('hd-layout-collapsed')
      toolbar.style.display = 'flex'
    } else {
      // 展开态：grid 归 React 管（官方按状态重写），只还原我们加的部分
      if (s) s.style.width = ''
      if (h) h.style.display = ''
      document.body.classList.remove('hd-layout-collapsed')
      toolbar.style.display = 'none'
    }
  }

  const boot = (): void => {
    if (process.env.HD_LAYOUT_DEBUG) {
      setTimeout(() => {
        const s = sidebar()
        console.log(
          '[hd-layout] sidebar=' +
            (s ? s.tagName + '.' + String(s.className).slice(0, 40) : 'NOT_FOUND') +
            ' collapsed=' + isCollapsed(),
        )
      }, 3000)
    }
    apply()
    // React 重渲染/用户折叠 → 跟随状态（节流）。style 变化经 style 属性 mutation 触发。
    let lastScan = 0
    const mo = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastScan < 200) return
      lastScan = now
      apply()
    })
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    // 兜底：官方 UI 延迟渲染侧栏时也能命中
    setTimeout(apply, 500)
    setTimeout(apply, 1500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

/**
 * 工作区面板注入（官方 UI 页面）：右侧抽屉展示 workspaceCwd 文件树 + 文件预览。
 *
 * 入口：① 折叠工具条（injectDesktopLayout 注入的 [data-hd-layout-toolbar]）追加
 *      "工作区"按钮（不修改 injectDesktopLayout 本身，运行时探测该工具条节点并追加）；
 *      ② 展开态下页面右上角浮动入口按钮 —— 折叠态时顶部工具条（更高 z-index、
 *      不透明背景、覆盖同一矩形区域）会自然遮住它，无需额外的折叠态判断。
 *
 * 面板本身是固定定位浮层，不挂在官方侧栏 DOM 内，因此不需要 MutationObserver
 * 兜底重挂；只有两个入口按钮需要在官方 UI 重渲染后重新确保存在。
 */
function injectWorkspacePanel() {
  const PANEL_ATTR = 'data-hd-workspace-panel'
  const TOOLBAR_BTN_ATTR = 'data-hd-workspace-toolbar-btn'
  const FLOAT_BTN_ATTR = 'data-hd-workspace-float-btn'

  let open = false
  let cwd: string | null = null
  let tree: WorkspaceFileNode[] | null = null
  let loading = false
  let errorMsg: string | null = null
  const openDirs = new Set<string>()
  let preview: { node: WorkspaceFileNode; content: string; truncated: boolean } | null = null
  let previewLoading = false

  /** 主题探测：与品牌/归档/布局注入同一套亮度启发式。 */
  const isDark = () =>
    !document.body?.hasAttribute('data-ds-light-theme') &&
    (document.body?.hasAttribute('data-ds-dark-theme') ||
      (() => {
        const s = document.body ? getComputedStyle(document.body).backgroundColor : ''
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
        if (!m) return true
        return Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114 <= 140
      })())

  const colors = () =>
    isDark()
      ? { bg: 'rgb(15,17,21)', bg2: 'rgb(10,11,14)', fg: '#e8eaf1', dim: '#9aa3b2', border: 'rgb(255 255 255 / 10%)', hover: 'rgb(255 255 255 / 8%)', danger: '#ff6b6b' }
      : { bg: '#ffffff', bg2: '#f7f8fa', fg: '#111418', dim: '#5a6472', border: 'rgb(0 0 0 / 8%)', hover: 'rgb(0 0 0 / 6%)', danger: '#d93a3a' }

  // 简单内联格式化（未来若 shared/workspace-format.ts 落地，可改为从那里 import）。
  const fmtSize = (n: number): string => {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1024 / 1024).toFixed(2) + ' MB'
  }
  const fmtTime = (ms: number): string => {
    if (!ms) return ''
    const d = new Date(ms)
    const now = new Date()
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
  }

  /** 与 injectDesktopLayout 相同的折叠态判定（按钮 aria-label 优先，宽度兜底）。 */
  const layoutCollapsed = (): boolean => {
    const s = document.querySelector('[class*="sidebarCol"]') as HTMLElement | null
    const b = s ? (s.querySelector('button[class*="_toggle"]') as HTMLElement | null) : null
    if (b) {
      const label = (b.getAttribute('aria-label') || '').trim()
      if (label) return /打开|open/i.test(label)
    }
    return s ? s.getBoundingClientRect().width < 100 : false
  }

  const ensurePanelEl = (): HTMLElement => {
    let panel = document.querySelector('[' + PANEL_ATTR + ']') as HTMLElement | null
    if (!panel) {
      panel = document.createElement('div')
      panel.setAttribute(PANEL_ATTR, '1')
      document.body.appendChild(panel)
    }
    return panel
  }

  const loadTree = async () => {
    if (!cwd) {
      tree = []
      render()
      return
    }
    loading = true
    errorMsg = null
    render()
    try {
      const list = await desktop.listWorkspace(cwd, { maxDepth: 3, limit: 800 })
      tree = list
      if (list.length > 0) openDirs.add(cwd)
    } catch (e) {
      errorMsg = (e as Error)?.message ?? '加载失败'
      tree = []
    } finally {
      loading = false
      render()
    }
  }

  const openFile = async (node: WorkspaceFileNode) => {
    if (!cwd) return
    previewLoading = true
    render()
    try {
      const res = await desktop.readWorkspaceFile(cwd, node.path)
      preview = res
        ? { node, content: res.content, truncated: res.truncated }
        : { node, content: '(无法读取该文件)', truncated: false }
    } catch (e) {
      preview = { node, content: '读取失败：' + ((e as Error)?.message ?? ''), truncated: false }
    } finally {
      previewLoading = false
      render()
    }
  }

  /** 递归渲染文件树到容器（目录可展开/收起，文件点击预览）。 */
  const renderTree = (container: HTMLElement, nodes: WorkspaceFileNode[], depth: number) => {
    const c = colors()
    for (const n of nodes) {
      const row = document.createElement('div')
      const isActiveFile = !n.isDir && preview !== null && preview.node.path === n.path
      row.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:4px 8px 4px ' + (8 + depth * 14) + 'px;' +
        'cursor:pointer;border-radius:4px;font:400 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:' +
        c.fg + ';background:' + (isActiveFile ? c.hover : 'transparent')
      row.onmouseenter = () => {
        row.style.background = c.hover
      }
      row.onmouseleave = () => {
        row.style.background = isActiveFile ? c.hover : 'transparent'
      }
      if (n.isDir) {
        const isOpen = openDirs.has(n.path)
        const caret = document.createElement('span')
        caret.textContent = isOpen ? '▾' : '▸'
        caret.style.cssText = 'width:12px;flex:none;opacity:.7'
        const icon = document.createElement('span')
        icon.textContent = '📁'
        const name = document.createElement('span')
        name.textContent = n.name
        name.title = n.name
        name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        const count = document.createElement('span')
        count.textContent = n.children ? String(n.children.length) : ''
        count.style.cssText = 'opacity:.55;font-size:11px'
        row.appendChild(caret)
        row.appendChild(icon)
        row.appendChild(name)
        row.appendChild(count)
        row.onclick = () => {
          if (openDirs.has(n.path)) openDirs.delete(n.path)
          else openDirs.add(n.path)
          render()
        }
        container.appendChild(row)
        if (isOpen && n.children) renderTree(container, n.children, depth + 1)
      } else {
        const spacer = document.createElement('span')
        spacer.style.cssText = 'width:12px;flex:none'
        const icon = document.createElement('span')
        icon.textContent = '📄'
        const name = document.createElement('span')
        name.textContent = n.name
        name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        const size = document.createElement('span')
        size.textContent = fmtSize(n.size)
        size.style.cssText = 'opacity:.55;font-size:11px'
        row.title = n.name + '\n' + fmtSize(n.size) + (n.mtime ? ' · ' + fmtTime(n.mtime) : '')
        row.appendChild(spacer)
        row.appendChild(icon)
        row.appendChild(name)
        row.appendChild(size)
        row.onclick = () => void openFile(n)
        container.appendChild(row)
      }
    }
  }

  /** 全量重绘面板（简单直接：数据量级不大，不做局部 diff）。 */
  const render = () => {
    const panel = ensurePanelEl()
    const c = colors()
    panel.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;width:380px;max-width:92vw;background:' + c.bg + ';' +
      'border-left:1px solid ' + c.border + ';z-index:10000;display:' + (open ? 'flex' : 'none') + ';' +
      'flex-direction:column;box-shadow:-6px 0 24px rgb(0 0 0 / 25%);' +
      'font-family:-apple-system,"Segoe UI",Roboto,sans-serif'
    panel.innerHTML = ''
    if (!open) return

    const header = document.createElement('div')
    header.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:12px 14px;border-bottom:1px solid ' + c.border + ';flex:none'
    const title = document.createElement('span')
    title.textContent = cwd ? (cwd.split(/[/\\]/).pop() || cwd) : '工作区'
    title.title = cwd || ''
    title.style.cssText =
      'flex:1;font:600 14px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.fg +
      ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    const refreshBtn = document.createElement('button')
    refreshBtn.textContent = '↻'
    refreshBtn.title = '刷新'
    refreshBtn.disabled = loading
    refreshBtn.style.cssText =
      'background:none;border:none;cursor:pointer;font-size:15px;color:' + c.fg + ';padding:4px;line-height:1;' +
      'opacity:' + (loading ? '.5' : '1')
    refreshBtn.onclick = () => void loadTree()
    const closeBtn = document.createElement('button')
    closeBtn.textContent = '✕'
    closeBtn.title = '关闭'
    closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:' + c.fg + ';padding:4px;line-height:1'
    closeBtn.onclick = () => {
      open = false
      render()
    }
    header.appendChild(title)
    header.appendChild(refreshBtn)
    header.appendChild(closeBtn)
    panel.appendChild(header)

    const body = document.createElement('div')
    body.style.cssText = 'flex:1;overflow-y:auto;padding:6px;min-height:0'

    if (!cwd) {
      const empty = document.createElement('div')
      empty.style.cssText = 'padding:20px 14px;color:' + c.dim + ';font-size:13px;line-height:1.6'
      const p1 = document.createElement('p')
      p1.style.margin = '0 0 6px'
      p1.textContent = '尚未选择工作区'
      const p2 = document.createElement('p')
      p2.style.cssText = 'margin:0;font-size:12px;opacity:.8'
      p2.textContent = '在设置中指定工作区目录后，这里会显示文件树。'
      empty.appendChild(p1)
      empty.appendChild(p2)
      body.appendChild(empty)
    } else if (errorMsg) {
      const err = document.createElement('div')
      err.style.cssText = 'padding:20px 14px;color:' + c.danger + ';font-size:13px'
      err.textContent = errorMsg
      body.appendChild(err)
    } else if (loading && !tree) {
      const l = document.createElement('div')
      l.style.cssText = 'padding:20px 14px;color:' + c.dim + ';font-size:13px'
      l.textContent = '加载文件树…'
      body.appendChild(l)
    } else if (tree && tree.length === 0) {
      const e2 = document.createElement('div')
      e2.style.cssText = 'padding:20px 14px;color:' + c.dim + ';font-size:13px'
      e2.textContent = '工作区为空'
      body.appendChild(e2)
    } else if (tree) {
      renderTree(body, tree, 0)
    }
    panel.appendChild(body)

    if (preview) {
      const previewWrap = document.createElement('div')
      previewWrap.style.cssText =
        'flex:0 0 45%;display:flex;flex-direction:column;border-top:1px solid ' + c.border + ';min-height:0'
      const pHeader = document.createElement('div')
      pHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;flex:none'
      const pName = document.createElement('span')
      pName.textContent = preview.node.name
      pName.title = preview.node.path
      pName.style.cssText =
        'flex:1;font:600 12px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;color:' + c.fg +
        ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      const pMeta = document.createElement('span')
      pMeta.textContent = fmtSize(preview.node.size)
      pMeta.style.cssText = 'font-size:11px;color:' + c.dim
      const pClose = document.createElement('button')
      pClose.textContent = '✕'
      pClose.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:' + c.fg + ';padding:2px 4px'
      pClose.onclick = () => {
        preview = null
        render()
      }
      pHeader.appendChild(pName)
      pHeader.appendChild(pMeta)
      pHeader.appendChild(pClose)
      previewWrap.appendChild(pHeader)

      const pre = document.createElement('pre')
      pre.style.cssText =
        'flex:1;overflow:auto;margin:0;padding:8px 12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'color:' + c.fg + ';white-space:pre-wrap;word-break:break-word;background:' + c.bg2
      pre.textContent = previewLoading ? '加载中…' : preview.content
      previewWrap.appendChild(pre)

      if (preview.truncated) {
        const note = document.createElement('div')
        note.textContent = '文件过大，仅预览前 256 KB'
        note.style.cssText = 'padding:4px 12px;font-size:11px;color:' + c.dim + ';flex:none'
        previewWrap.appendChild(note)
      }
      panel.appendChild(previewWrap)
    }
  }

  /** 打开/关闭面板；每次打开都重新读取 workspaceCwd（设置里可能刚改过）。 */
  const toggle = async () => {
    open = !open
    if (!open) {
      render()
      return
    }
    render()
    const stateRes = await api.getAppState()
    const newCwd = stateRes.ok ? (stateRes.value?.workspaceCwd ?? null) : null
    if (newCwd !== cwd) {
      cwd = newCwd
      tree = null
      openDirs.clear()
      preview = null
    }
    render()
    if (cwd && !tree) void loadTree()
  }

  /** 顶部折叠工具条（injectDesktopLayout 注入）追加"工作区"按钮；不修改该函数本身。 */
  const ensureToolbarButton = () => {
    const tb = document.querySelector('[data-hd-layout-toolbar]') as HTMLElement | null
    if (!tb) return
    if (tb.querySelector('[' + TOOLBAR_BTN_ATTR + ']')) return
    const c = colors()
    const btn = document.createElement('button')
    btn.setAttribute(TOOLBAR_BTN_ATTR, '1')
    btn.textContent = '工作区'
    btn.title = '工作区文件'
    btn.style.cssText =
      'height:30px;padding:0 12px;border-radius:6px;border:1px solid transparent;cursor:pointer;' +
      'font:500 13px/1 -apple-system,"Segoe UI",Roboto,sans-serif;background:transparent;color:' + c.fg + ';' +
      'transition:background .15s'
    btn.onmouseenter = () => {
      btn.style.background = c.hover
    }
    btn.onmouseleave = () => {
      btn.style.background = 'transparent'
    }
    btn.onclick = () => void toggle()
    if (tb.lastElementChild) tb.insertBefore(btn, tb.lastElementChild)
    else tb.appendChild(btn)
  }

  /**
   * 展开态右上角浮动入口。折叠态时顶部工具条（z-index 更高、覆盖同一矩形区域、
   * 不透明背景）会自然把它盖住，故此处不需要重复折叠态判断逻辑来隐藏它——
   * 仍保留 layoutCollapsed() 判断是为了在折叠态下把它显式设为不可交互（防止
   * 工具条尚未渲染出来的极短暂窗口期内被误点）。
   */
  const ensureFloatButton = () => {
    let btn = document.querySelector('[' + FLOAT_BTN_ATTR + ']') as HTMLButtonElement | null
    const c = colors()
    if (!btn) {
      btn = document.createElement('button')
      btn.setAttribute(FLOAT_BTN_ATTR, '1')
      btn.textContent = '📂'
      btn.title = '工作区'
      btn.onclick = () => void toggle()
      document.body.appendChild(btn)
    }
    const collapsed = layoutCollapsed()
    btn.style.cssText =
      'position:fixed;top:10px;right:14px;width:34px;height:34px;border-radius:8px;border:1px solid ' +
      c.border + ';background:' + c.bg + ';color:' + c.fg + ';cursor:pointer;font-size:16px;z-index:9998;' +
      'display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgb(0 0 0 / 15%);' +
      'pointer-events:' + (collapsed ? 'none' : 'auto') + ';opacity:' + (collapsed ? '0' : '1')
  }

  const boot = () => {
    ensureToolbarButton()
    ensureFloatButton()
    let lastScan = 0
    const mo = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastScan < 300) return
      lastScan = now
      ensureToolbarButton()
      ensureFloatButton()
    })
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-label'],
    })
    setTimeout(() => {
      ensureToolbarButton()
      ensureFloatButton()
    }, 500)
    setTimeout(() => {
      ensureToolbarButton()
      ensureFloatButton()
    }, 1500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}


injectDesktopBrand()
injectArchivedPanel()
injectUsagePanel()
injectDesktopLayout()
injectWorkspacePanel()