import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchivedSessionInfo, SessionSummary } from '../../shared/types'
import SessionContextMenu from './SessionContextMenu'
import {
  IconPanel,
  IconSearch,
  IconPlus,
  IconTasks,
  IconChat,
  IconSettings,
  IconRefresh,
  IconMore,
  IconChevron,
  IconClose,
} from './icons'

interface Props {
  collapsed: boolean
  onCollapse: () => void
  onSearch: () => void
  sessions: SessionSummary[]
  archivedSessions: ArchivedSessionInfo[]
  activeId: string | null
  loading: boolean
  creating: boolean
  pinnedSessionIds: string[]
  sessionColors: Record<string, string>
  view: 'chat' | 'tasks'
  onSwitchView: (v: 'chat' | 'tasks') => void
  onNewChat: () => void
  onSelect: (id: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
  onRename: (id: string, title: string) => Promise<boolean>
  onTogglePin: (id: string) => void
  onSetColor: (id: string, color: string) => void
  onFork: (id: string) => Promise<boolean>
  onArchive: (id: string) => Promise<boolean>
  onDelete: (id: string, cwd?: string) => Promise<boolean>
  onDeleteArchived: (id: string, cwd?: string) => Promise<boolean>
  onExport: (id: string) => void
  onCopyId: (id: string) => void
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

interface MenuState {
  sessionId: string
  x: number
  y: number
}

export default function Sidebar({
  collapsed,
  onCollapse,
  onSearch,
  sessions,
  archivedSessions,
  activeId,
  loading,
  creating,
  pinnedSessionIds,
  sessionColors,
  view,
  onSwitchView,
  onNewChat,
  onSelect,
  onOpenSettings,
  onRefresh,
  onRename,
  onTogglePin,
  onSetColor,
  onFork,
  onArchive,
  onDelete,
  onDeleteArchived,
  onExport,
  onCopyId,
}: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [archivedCollapsed, setArchivedCollapsed] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const pinnedSet = new Set(pinnedSessionIds)

  const startRename = useCallback((session: SessionSummary) => {
    setEditingId(session.sessionId)
    setEditValue(session.title === '新会话' ? '' : session.title)
    setMenu(null)
  }, [])

  // 三点下拉：锚定到按钮位置弹出右键菜单
  const openMenuAt = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ sessionId, x: rect.right - 180, y: rect.bottom + 4 })
  }, [])

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const commitRename = async () => {
    if (editingId) {
      await onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const menuSession = menu ? sessions.find((s) => s.sessionId === menu.sessionId) ?? null : null

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-inner">
      <div className="sidebar-head">
        <span className="sidebar-brand">会话</span>
        <div className="sidebar-head-actions">
          <button className="sidebar-collapse-btn" onClick={onSearch} title="搜索会话 (⌘K)" aria-label="搜索会话">
            <IconSearch size={16} />
          </button>
          <button className="sidebar-collapse-btn" onClick={onCollapse} title="收起侧边栏 (⌘B)" aria-label="收起侧边栏">
            <IconPanel collapsed={false} size={16} />
          </button>
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="new-chat-btn" onClick={onNewChat} disabled={creating}>
          <span className="new-chat-icon">{creating ? <IconMore size={16} /> : <IconPlus size={16} />}</span>
          {creating ? '创建中…' : '新会话'}
        </button>
        <button
          className={`tasks-btn ${view === 'tasks' ? 'active' : ''}`}
          onClick={() => onSwitchView(view === 'tasks' ? 'chat' : 'tasks')}
        >
          {view === 'tasks' ? <IconChat size={14} /> : <IconTasks size={14} />}
          <span>{view === 'tasks' ? '返回会话' : '任务面板'}</span>
        </button>
      </div>

      <div className="session-list">
        {loading && <div className="sidebar-hint">加载会话…</div>}
        {!loading && sessions.length === 0 && (
          <div className="sidebar-hint">
            还没有会话
            <br />
            点击「新会话」开始
          </div>
        )}
        {sessions.map((s) => {
          const isActive = s.sessionId === activeId
          const isPinned = pinnedSet.has(s.sessionId)
          const color = sessionColors[s.sessionId] || undefined
          const isEditing = editingId === s.sessionId
          return (
            <div
              key={s.sessionId}
              className={`session-row ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (!isEditing) onSelect(s.sessionId)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ sessionId: s.sessionId, x: e.clientX, y: e.clientY })
              }}
            >
              {color && <span className="session-color-strip" style={{ background: color }} />}
              <button className="session-item" title={s.title}>
                <span className="session-item-top">
                  <span className="session-indicator" aria-hidden>
                    {s.running ? <span className="session-spinner" /> : <span className="session-dot" />}
                  </span>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="session-rename-input"
                      value={editValue}
                      placeholder="会话标题"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={() => void commitRename()}
                    />
                  ) : (
                    <span
                      className="session-title"
                      title={s.title || '新会话'}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        startRename(s)
                      }}
                    >
                      {isPinned && <span className="pin-mark">顶</span>}
                      {s.title || '新会话'}
                    </span>
                  )}
                </span>
                <span className="session-meta">{formatTime(s.updatedAt)}</span>
              </button>
              {!isEditing && (
                <span className="session-quick-actions">
                  <button
                    className="session-more-btn"
                    title="更多"
                    onClick={(e) => openMenuAt(e, s.sessionId)}
                  >
                    <IconMore size={15} />
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>

      {archivedSessions.length > 0 && (
        <div className="archived-group">
          <button
            className="archived-header"
            onClick={() => setArchivedCollapsed((c) => !c)}
            title={archivedCollapsed ? '展开归档会话' : '收起归档会话'}
          >
            <span className="archived-caret">
              <IconChevron collapsed={archivedCollapsed} size={12} />
            </span>
            <span className="archived-label">归档</span>
            <span className="archived-count">{archivedSessions.length}</span>
          </button>
          {!archivedCollapsed && (
            <div className="archived-list">
              {archivedSessions.map((s) => {
                const title = s.title || `归档会话 ${s.sessionId.slice(0, 6)}`
                const confirming = confirmDeleteId === s.sessionId
                return (
                  <div key={s.sessionId} className="archived-row">
                    {confirming ? (
                      <>
                        <span className="archived-confirm-text">确认删除？</span>
                        <span className="archived-confirm-actions">
                          <button
                            className="archived-confirm-btn danger"
                            onClick={() => {
                              setConfirmDeleteId(null)
                              void onDeleteArchived(s.sessionId, s.cwd)
                            }}
                          >
                            删除
                          </button>
                          <button
                            className="archived-confirm-btn"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            取消
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="archived-title" title={title}>
                          {title}
                        </span>
                        <button
                          className="archived-delete-btn"
                          title="删除归档会话"
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDeleteId(s.sessionId)
                          }}
                        >
                          <IconClose size={12} />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onOpenSettings} title="设置">
          <IconSettings size={15} />
          <span>设置</span>
        </button>
        <button className="sidebar-icon-btn" onClick={onRefresh} title="刷新列表" aria-label="刷新列表">
          <IconRefresh size={15} />
        </button>
      </div>

      </div>

      {menu && menuSession && (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          pinned={pinnedSet.has(menuSession.sessionId)}
          color={sessionColors[menuSession.sessionId] || undefined}
          onClose={() => setMenu(null)}
          onRename={() => startRename(menuSession)}
          onTogglePin={() => onTogglePin(menuSession.sessionId)}
          onSetColor={(c) => onSetColor(menuSession.sessionId, c)}
          onCopyId={() => onCopyId(menuSession.sessionId)}
          onFork={() => void onFork(menuSession.sessionId)}
          onExport={() => onExport(menuSession.sessionId)}
          onArchive={() => void onArchive(menuSession.sessionId)}
          onDelete={() => void onDelete(menuSession.sessionId, menuSession.cwd)}
        />
      )}
    </aside>
  )
}
