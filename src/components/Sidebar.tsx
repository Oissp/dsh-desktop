import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchivedSessionInfo, SessionSummary } from '../../shared/types'
import { formatTime } from '../format'
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

interface MenuState {
  sessionId: string
  x: number
  y: number
  archived?: boolean
}

/** 统一的会话行数据：工作区会话与归档会话共用此形状渲染。 */
interface SessionRowData {
  sessionId: string
  title: string
  timestamp: number
  running?: boolean
  pinned?: boolean
  color?: string
}

interface SessionRowProps {
  data: SessionRowData
  active: boolean
  editing?: boolean
  editValue?: string
  editInputRef?: React.Ref<HTMLInputElement>
  onEditChange?: (value: string) => void
  onEditCommit?: () => void
  onEditCancel?: () => void
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMore: (e: React.MouseEvent) => void
  onRename?: () => void
}

/** 会话行：工作区会话与归档会话共用。归档行不传 running/pinned/color/onRename，
 *  自然不渲染 spinner/置顶标记/颜色条/双击重命名——差异由传入的 props 决定。 */
function SessionRow({
  data,
  active,
  editing,
  editValue,
  editInputRef,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onSelect,
  onContextMenu,
  onMore,
  onRename,
}: SessionRowProps) {
  const { title, timestamp, running, pinned, color } = data
  return (
    <div
      className={`session-row ${active ? 'active' : ''}`}
      onClick={() => {
        if (!editing) onSelect()
      }}
      onContextMenu={onContextMenu}
    >
      {color && <span className="session-color-strip" style={{ background: color }} />}
      <button className="session-item" title={title}>
        <span className="session-item-top">
          <span className="session-indicator" aria-hidden>
            {running ? <span className="session-spinner" /> : <span className="session-dot" />}
          </span>
          {editing ? (
            <input
              ref={editInputRef}
              className="session-rename-input"
              value={editValue}
              placeholder="会话标题"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onEditChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEditCommit?.()
                if (e.key === 'Escape') onEditCancel?.()
              }}
              onBlur={() => onEditCommit?.()}
            />
          ) : (
            <span
              className="session-title"
              title={title}
              onDoubleClick={(e) => {
                if (onRename) {
                  e.stopPropagation()
                  onRename()
                }
              }}
            >
              {pinned && <span className="pin-mark">顶</span>}
              {title}
            </span>
          )}
        </span>
        <span className="session-meta">{formatTime(timestamp)}</span>
      </button>
      {!editing && (
        <span className="session-quick-actions">
          <button className="session-more-btn" title="更多" onClick={onMore}>
            <IconMore size={15} />
          </button>
        </span>
      )}
    </div>
  )
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
  const editInputRef = useRef<HTMLInputElement>(null)

  const pinnedSet = new Set(pinnedSessionIds)

  const startRename = useCallback((session: SessionSummary) => {
    setEditingId(session.sessionId)
    setEditValue(session.title === '新会话' ? '' : session.title)
    setMenu(null)
  }, [])

  // 三点下拉：锚定到按钮位置弹出右键菜单。archived=true 时菜单只含归档会话可用操作。
  const openMenuAt = useCallback((e: React.MouseEvent, sessionId: string, archived = false) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ sessionId, x: rect.right - 180, y: rect.bottom + 4, archived })
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

  // 菜单目标会话：先查活跃会话，再查归档会话（右键/三点菜单可能作用在任一列表）
  const menuArchived = menu?.archived ?? false
  const menuSession = menu
    ? sessions.find((s) => s.sessionId === menu.sessionId) ?? null
    : null
  const menuArchivedSession = menu
    ? archivedSessions.find((s) => s.sessionId === menu.sessionId) ?? null
    : null

  // 兜底：菜单打开期间会话从列表消失（被外部事件归档/删除）→ 两处查找都为 null，
  // 菜单无法渲染但 menu 状态残留。这里检测到后清除，避免过期菜单状态滞留。
  useEffect(() => {
    if (menu && !menuSession && !menuArchivedSession) setMenu(null)
  }, [menu, menuSession, menuArchivedSession])

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
            <SessionRow
              key={s.sessionId}
              data={{
                sessionId: s.sessionId,
                title: s.title || '新会话',
                timestamp: s.updatedAt,
                running: s.running,
                pinned: isPinned,
                color,
              }}
              active={isActive}
              editing={isEditing}
              editValue={editValue}
              editInputRef={editInputRef}
              onEditChange={setEditValue}
              onEditCommit={() => void commitRename()}
              onEditCancel={() => setEditingId(null)}
              onSelect={() => onSelect(s.sessionId)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ sessionId: s.sessionId, x: e.clientX, y: e.clientY })
              }}
              onMore={(e) => openMenuAt(e, s.sessionId)}
              onRename={() => startRename(s)}
            />
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
            <div className="session-list archived-list">
              {archivedSessions.map((s) => {
                const title = s.title || `归档会话 ${s.sessionId.slice(0, 6)}`
                const isActive = s.sessionId === activeId
                return (
                  <SessionRow
                    key={s.sessionId}
                    data={{
                      sessionId: s.sessionId,
                      title,
                      timestamp: s.archivedAt ?? 0,
                    }}
                    active={isActive}
                    onSelect={() => {
                      /* 归档会话查看由官方插件面板处理，点击行不切换会话 */
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ sessionId: s.sessionId, x: e.clientX, y: e.clientY, archived: true })
                    }}
                    onMore={(e) => openMenuAt(e, s.sessionId, true)}
                  />
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

      {menu && (menuSession || menuArchivedSession) && (() => {
        const sid = menuArchived ? menuArchivedSession!.sessionId : menuSession!.sessionId
        const cwd = menuArchived ? menuArchivedSession!.cwd : menuSession!.cwd
        return (
          <SessionContextMenu
            x={menu.x}
            y={menu.y}
            archived={menuArchived}
            pinned={menuArchived ? false : pinnedSet.has(sid)}
            color={menuArchived ? undefined : (sessionColors[sid] || undefined)}
            onClose={() => setMenu(null)}
            onRename={() => menuSession && startRename(menuSession)}
            onTogglePin={() => onTogglePin(sid)}
            onSetColor={(c) => onSetColor(sid, c)}
            onCopyId={() => onCopyId(sid)}
            onFork={() => void onFork(sid)}
            onExport={() => onExport(sid)}
            onArchive={() => void onArchive(sid)}
            onDelete={() => void (menuArchived ? onDeleteArchived(sid, cwd) : onDelete(sid, cwd))}
          />
        )
      })()}
    </aside>
  )
}
