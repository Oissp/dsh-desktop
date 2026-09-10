import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, ArchivedSessionInfo, DshStatus, SessionSummary, TaskRecord } from '../../shared/types'
import { subscribeAll } from '../bus'
import { TaskStore } from '../tasks'
import Sidebar from './Sidebar'
import ChatView from './ChatView'
import TaskPanel from './TaskPanel'
import SettingsModal from './SettingsModal'
import SessionSearch from './SessionSearch'
import { IconPanel, IconPlus, IconSearch, IconTasks, IconChat, IconSettings, IconMore } from './icons'

const harness = window.harness

interface Props {
  appSettings: AppSettings
  dshStatus: DshStatus | null
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<{ ok: boolean; error?: { message?: string } }>
  sessionListVersion: number
  onSessionListTick: () => void
}

export default function MainView({
  appSettings,
  dshStatus,
  onUpdateSettings,
  sessionListVersion,
  onSessionListTick,
}: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [creating, setCreating] = useState(false)
  const [modelsTick, setModelsTick] = useState(0)
  const [mode, setMode] = useState('standard')
  const [apiKeyMissing, setApiKeyMissing] = useState(false)
  const [keyTick, setKeyTick] = useState(0)
  const [view, setView] = useState<'chat' | 'tasks'>('chat')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  // 侧边栏折叠态持久化在设置里，重启后保持上次的形态
  const [collapsed, setCollapsed] = useState(appSettings.sidebarCollapsed ?? false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  const listRefreshRef = useRef(() => {})

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      void onUpdateSettings({ sidebarCollapsed: next })
      return next
    })
  }, [onUpdateSettings])

  // 任务存储：从会话事件推导任务状态
  const taskStoreRef = useRef<TaskStore | null>(null)
  if (!taskStoreRef.current) {
    taskStoreRef.current = new TaskStore((next) => {
      void onUpdateSettings({ tasks: next })
    })
  }
  useEffect(() => {
    const unsub = taskStoreRef.current!.subscribe((t) => setTasks(t))
    taskStoreRef.current!.load(appSettings.tasks ?? [])
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 任务事件流 → 更新任务状态
  useEffect(() => {
    return subscribeAll((evt) => {
      taskStoreRef.current?.handleEvent(evt)
    })
  }, [])

  // 定时提醒触发 → 自动创建任务（E）
  useEffect(() => {
    return harness.onReminderFired(({ sessionId, text }) => {
      taskStoreRef.current?.startTask(sessionId, `[定时提醒] ${text}`, 'schedule')
    })
  }, [])

  const startTask = useCallback((sessionId: string, title: string) => {
    taskStoreRef.current?.startTask(sessionId, title, 'chat')
  }, [])

  const retryTask = useCallback((taskId: string) => {
    const info = taskStoreRef.current?.retry(taskId)
    if (info) {
      setActiveId(info.sessionId)
      setView('chat')
      // 重试 = 重新发同一 prompt
      void harness.sendMessage(info.sessionId, info.title)
    }
  }, [])

  // 检测 DeepSeek API Key 是否配置（用于输入区提示条；设置关闭后重新检测）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await harness.hasApiKey()
      if (alive) setApiKeyMissing(!res.ok || !res.value)
    })()
    return () => {
      alive = false
    }
  }, [keyTick])

  // 置顶会话排最前（按置顶先后），其余按 updatedAt 降序
  const pinnedSessionIds = appSettings.pinnedSessionIds ?? []
  const sessionColors = appSettings.sessionColors ?? {}
  const displaySessions = useMemo(() => {
    // 去重保险（sessionId 唯一），避免侧栏出现同一会话两行
    const uniq = sessions.filter((s, i, arr) => arr.findIndex((x) => x.sessionId === s.sessionId) === i)
    const pinnedSet = new Set(pinnedSessionIds)
    const pinned = pinnedSessionIds
      .map((id) => uniq.find((s) => s.sessionId === id))
      .filter((s): s is SessionSummary => Boolean(s))
    const rest = uniq.filter((s) => !pinnedSet.has(s.sessionId))
    return [...pinned, ...rest]
  }, [sessions, pinnedSessionIds])

  // 快捷键：⌘/Ctrl+B 折叠侧边栏，⌘/Ctrl+K 唤起搜索，Esc 关闭搜索。
  // ⌘F 只在非输入场景下劫持为搜索——输入框里的 ⌘F 留给系统/编辑器。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
        if (searchOpenRef.current) {
          e.preventDefault()
          setSearchOpen(false)
        }
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        toggleCollapsed()
      } else if (key === 'k' || (key === 'f' && !isEditableFocus())) {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCollapsed])

  const refreshSessions = useCallback(async () => {
    const res = await harness.listSessions()
    if (!res.ok) return
    const items = res.value!
    // 保留侧边栏已收到的 running 状态（bus 实时事件为准），
    // 避免 session.list 的延迟/竞态把转圈状态覆盖掉
    setSessions((prev) => {
      const runningById = new Map(prev.map((s) => [s.sessionId, s.running]))
      return items.map((s) => ({
        ...s,
        running: runningById.get(s.sessionId) ?? s.running,
      }))
    })
    // 激活一个会话：优先保持当前，否则第一个非空白会话
    if (activeId) {
      const stillThere = items.some((s) => s.sessionId === activeId)
      if (!stillThere) {
        const next = items.find((s) => !s.blank) ?? items[0]
        setActiveId(next?.sessionId ?? null)
      }
    } else {
      const next = items.find((s) => !s.blank) ?? items[0]
      setActiveId(next?.sessionId ?? null)
    }
    setLoadingList(false)
  }, [activeId])

  useEffect(() => {
    void refreshSessions()
  }, [sessionListVersion])

  // 归档分组：从 workspace.follow baseline 拉取归档会话（仅 sessionId + cwd）
  const refreshArchived = useCallback(async () => {
    const res = await harness.listArchivedSessions()
    if (!res.ok) return
    setArchivedSessions(res.value!)
  }, [])

  useEffect(() => {
    void refreshArchived()
  }, [refreshArchived])

  // 归档会话标题/cwd 合并本地元数据（refreshArchived 只拉 sessionId，标题归档后无处可查故读缓存）
  const archivedMeta = appSettings.archivedSessionMeta
  const archivedDisplay = useMemo(
    () =>
      archivedSessions.map((s) => {
        const meta = archivedMeta?.[s.sessionId]
        return {
          sessionId: s.sessionId,
          title: meta?.title,
          cwd: s.cwd ?? meta?.cwd,
          archivedAt: meta?.archivedAt,
        }
      }),
    [archivedSessions, archivedMeta],
  )

  // 归档会话整形为 SessionSummary，供命令面板同池搜索（折叠态下唯一入口）
  const archivedSearchable = useMemo<SessionSummary[]>(
    () =>
      archivedDisplay.map((s) => ({
        sessionId: s.sessionId,
        title: s.title || '',
        updatedAt: s.archivedAt ?? 0,
        running: false,
        blank: false,
        cwd: s.cwd,
      })),
    [archivedDisplay],
  )

  // 会话 running 状态即时更新（无需等 session.list 往返），让侧边栏转圈即时生效
  const runningTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    return subscribeAll((evt) => {
      if (evt.kind !== 'running') return
      const { sessionId, running } = evt
      if (running) {
        // 新的工作状态：取消可能挂起的「停止」计时器，立即转圈
        const timers = runningTimersRef.current
        const pending = timers.get(sessionId)
        if (pending) {
          clearTimeout(pending)
          timers.delete(sessionId)
        }
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === sessionId ? { ...s, running: true } : s)),
        )
      } else {
        // 停止：延迟 MIN_RUNNING_MS 生效，保证转圈至少可见一小段（短任务也有反馈）
        const timers = runningTimersRef.current
        const existing = timers.get(sessionId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          timers.delete(sessionId)
          setSessions((prev) =>
            prev.map((s) => (s.sessionId === sessionId ? { ...s, running: false } : s)),
          )
        }, 800)
        timers.set(sessionId, timer)
      }
    })
  }, [])

  useEffect(() => {
    listRefreshRef.current = refreshSessions
  }, [refreshSessions])

  const newChat = useCallback(async () => {
    setCreating(true)
    try {
      const res = await harness.createSession(appSettings.workspaceCwd ?? undefined, mode)
      if (res.ok) {
        setActiveId(res.value!.sessionId)
        await refreshSessions()
      }
    } finally {
      setCreating(false)
    }
  }, [appSettings.workspaceCwd, refreshSessions, mode])

  // 空状态首页直接发送：会话已由 ChatView 创建，这里只激活 + 刷新列表
  const activateSession = useCallback(
    async (sessionId: string) => {
      setActiveId(sessionId)
      setView('chat')
      await refreshSessions()
    },
    [refreshSessions],
  )

  // 菜单快捷键：Cmd+N 新会话 / Cmd+, 设置
  useEffect(() => {
    return harness.onMenuEvent((action) => {
      if (action === 'new-chat') void newChat()
      else if (action === 'open-settings') setSettingsOpen(true)
    })
  }, [newChat])

  const selectSession = useCallback((id: string) => {
    setActiveId(id)
    // 切换会话时同步模式为该会话的 agent preset
    const s = sessions.find((x) => x.sessionId === id)
    if (s?.agentPreset) setMode(s.agentPreset)
    onSessionListTick()
  }, [sessions, onSessionListTick])

  const changeWorkspace = useCallback(async () => {
    const res = await harness.pickDirectory()
    if (!res.ok || !res.value) return
    await onUpdateSettings({ workspaceCwd: res.value })
    onSessionListTick()
  }, [onUpdateSettings, onSessionListTick])

  // ---- 会话管理操作 ----

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      if (!title.trim()) return false
      const res = await harness.renameSession(sessionId, title.trim())
      if (res.ok) onSessionListTick()
      return res.ok
    },
    [onSessionListTick],
  )

  const togglePin = useCallback(
    async (sessionId: string) => {
      const current = appSettings.pinnedSessionIds ?? []
      const next = current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
      await onUpdateSettings({ pinnedSessionIds: next })
    },
    [appSettings.pinnedSessionIds, onUpdateSettings],
  )

  const setSessionColor = useCallback(
    async (sessionId: string, color: string) => {
      const current = appSettings.sessionColors ?? {}
      await onUpdateSettings({ sessionColors: { ...current, [sessionId]: color } })
    },
    [appSettings.sessionColors, onUpdateSettings],
  )

  const forkSession = useCallback(
    async (sessionId: string) => {
      const res = await harness.forkSession(sessionId)
      if (res.ok) {
        setActiveId(res.value!.sessionId)
        await refreshSessions()
      }
      return res.ok
    },
    [refreshSessions],
  )

  const archiveSession = useCallback(
    async (sessionId: string) => {
      // 归档前缓存标题/cwd 到本地元数据（session.list 归档后不再返回，标题无处可查）
      const s = sessions.find((x) => x.sessionId === sessionId)
      if (s) {
        const meta = appSettings.archivedSessionMeta ?? {}
        await onUpdateSettings({
          archivedSessionMeta: {
            ...meta,
            [sessionId]: { title: s.title, cwd: s.cwd, archivedAt: Date.now() },
          },
        })
      }
      const res = await harness.archiveSession(sessionId)
      if (res.ok) {
        setActiveId((cur) => (cur === sessionId ? null : cur))
        await refreshSessions()
        await refreshArchived()
      }
      return res.ok
    },
    [sessions, appSettings.archivedSessionMeta, onUpdateSettings, refreshSessions, refreshArchived],
  )

  const deleteArchivedSession = useCallback(
    async (sessionId: string, cwd?: string) => {
      const res = await harness.hardDeleteSession(sessionId, cwd)
      if (!res.ok) return false
      // 清理本地元数据并刷新归档列表
      const meta = appSettings.archivedSessionMeta ?? {}
      if (meta[sessionId]) {
        const next = { ...meta }
        delete next[sessionId]
        await onUpdateSettings({ archivedSessionMeta: next })
      }
      // 删掉正在高亮的归档会话：清除 activeId，否则侧栏 activeId 指向不存在的条目。
      setActiveId((cur) => (cur === sessionId ? null : cur))
      await refreshArchived()
      return true
    },
    [appSettings.archivedSessionMeta, onUpdateSettings, refreshArchived],
  )

  const hardDeleteSession = useCallback(
    async (sessionId: string, cwd?: string) => {
      const res = await harness.hardDeleteSession(sessionId, cwd)
      if (res.ok) {
        setActiveId((cur) => (cur === sessionId ? null : cur))
        await refreshSessions()
      }
      return res.ok
    },
    [refreshSessions],
  )

  const exportSession = useCallback(async (sessionId: string, format: 'zip' | 'markdown' = 'zip') => {
    await harness.exportSession(sessionId, format)
  }, [])

  const copySessionId = useCallback(async (sessionId: string) => {
    await harness.copyText(sessionId)
  }, [])

  return (
    <div className="app-shell">
      {/* 折叠态顶部工具条：常驻渲染，靠高度动画收放，避免挂载/卸载造成的跳动。
          内容仅在折叠态挂载，收起时不会留下可 Tab 到的隐藏按钮。 */}
      <header className={`collapsed-bar ${collapsed ? 'is-visible' : ''}`} aria-hidden={!collapsed}>
        {collapsed && (
        <div className="collapsed-bar-inner">
          <button
            className="cb-btn"
            onClick={toggleCollapsed}
            title="展开侧边栏 (⌘B)"
            aria-label="展开侧边栏"
          >
            <IconPanel collapsed size={17} />
          </button>

          {/* 搜索入口做成真实的输入框样式，点击唤起命令面板 */}
          <button className="cb-search" onClick={() => setSearchOpen(true)} title="搜索会话 (⌘K)">
            <IconSearch size={14} className="cb-search-icon" />
            <span className="cb-search-ph">搜索会话…</span>
            <kbd className="cb-search-kbd">⌘K</kbd>
          </button>

          <span className="cb-divider" />

          <button
            className="cb-btn cb-label"
            onClick={newChat}
            disabled={creating}
            title="新会话"
            aria-label="新会话"
          >
            {creating ? <IconMore size={17} /> : <IconPlus size={17} />}
            <span>{creating ? '创建中…' : '新会话'}</span>
          </button>
          <button
            className={`cb-btn ${view === 'tasks' ? 'active' : ''}`}
            onClick={() => setView(view === 'tasks' ? 'chat' : 'tasks')}
            title={view === 'tasks' ? '返回会话' : '任务面板'}
            aria-label={view === 'tasks' ? '返回会话' : '任务面板'}
          >
            {view === 'tasks' ? <IconChat size={17} /> : <IconTasks size={17} />}
          </button>
          <button
            className="cb-btn"
            onClick={() => setSettingsOpen(true)}
            title="设置"
            aria-label="设置"
          >
            <IconSettings size={17} />
          </button>
        </div>
        )}
      </header>
      <div className="app-body">
        <Sidebar
          collapsed={collapsed}
          onCollapse={toggleCollapsed}
          onSearch={() => setSearchOpen(true)}
          sessions={displaySessions}
          archivedSessions={archivedDisplay}
          activeId={activeId}
          loading={loadingList}
          creating={creating}
          pinnedSessionIds={pinnedSessionIds}
          sessionColors={sessionColors}
          view={view}
          onSwitchView={setView}
          onNewChat={newChat}
          onSelect={selectSession}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefresh={() => {
            setLoadingList(true)
            void refreshSessions()
            void refreshArchived()
          }}
          onRename={renameSession}
          onTogglePin={togglePin}
          onSetColor={setSessionColor}
          onFork={forkSession}
          onArchive={archiveSession}
          onDelete={hardDeleteSession}
          onDeleteArchived={deleteArchivedSession}
          onExport={exportSession}
          onCopyId={copySessionId}
        />
        {view === 'chat' ? (
          <ChatView
            sessionId={activeId}
            onTitleChange={() => onSessionListTick()}
            modelsTick={modelsTick}
            workspaceCwd={appSettings.workspaceCwd}
            mode={mode}
            onModeChange={setMode}
            onChangeWorkspace={changeWorkspace}
            apiKeyMissing={apiKeyMissing}
            onOpenSettings={() => setSettingsOpen(true)}
            onTaskCreated={startTask}
            onSessionCreated={(id) => void activateSession(id)}
          />
        ) : (
          <TaskPanel
            tasks={tasks}
            onRetry={retryTask}
            onCancel={(sessionId) => void harness.cancelTurn(sessionId)}
          />
        )}
      </div>
      {searchOpen && (
        <SessionSearch
          sessions={displaySessions}
          archivedSessions={archivedSearchable}
          activeId={activeId}
          onSelect={selectSession}
          onNewChat={newChat}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          appSettings={appSettings}
          dshStatus={dshStatus}
          activeSessionId={activeId}
          planActive={sessions.find((s) => s.sessionId === activeId)?.planActive ?? false}
          onUpdateSettings={onUpdateSettings}
          onClose={() => {
            setSettingsOpen(false)
            setKeyTick((t) => t + 1)
          }}
          onWorkspaceChanged={() => onSessionListTick()}
          onProvidersChanged={() => setModelsTick((t) => t + 1)}
          onPlanToggle={(active) => {
            // 乐观更新当前会话计划模式状态
            setSessions((prev) =>
              prev.map((s) => (s.sessionId === activeId ? { ...s, planActive: active } : s)),
            )
          }}
        />
      )}
    </div>
  )
}

/** 焦点是否落在可编辑区域（输入框/文本域/contenteditable）。 */
function isEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

