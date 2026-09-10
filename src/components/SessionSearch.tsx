import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/types'
import { formatTime } from '../format'
import { IconSearch, IconClose, IconChat } from './icons'

interface Props {
  sessions: SessionSummary[]
  /** 归档会话：折叠态下唯一的入口，一并纳入搜索 */
  archivedSessions?: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onClose: () => void
}

/** 高亮命中的字符片段。 */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query)
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

/**
 * 会话搜索面板（参考 Alma 折叠态的顶部搜索）：
 * 居中命令面板，支持 ↑/↓ 选择、Enter 打开、Esc 关闭、点击遮罩关闭。
 */
export default function SessionSearch({ sessions, archivedSessions, activeId, onSelect, onNewChat, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()

  // 空关键词 = 最近会话列表（兼作快速切换器），有关键词 = 标题过滤。
  // 归档会话同池搜索，但同分时权重低于活跃会话。
  const results = useMemo(() => {
    const pool: { s: SessionSummary; archived: boolean }[] = [
      ...sessions.map((s) => ({ s, archived: false })),
      ...(archivedSessions ?? []).map((s) => ({ s, archived: true })),
    ]
    // 空关键词只给最近活跃会话，归档留在输入关键词后再捞
    if (!q) return sessions.slice(0, 12).map((s) => ({ s, archived: false }))
    return pool
      .map((item) => {
        const title = (item.s.title || '新会话').toLowerCase()
        const idx = title.indexOf(q)
        // 前缀命中优先，其次包含命中，越靠前权重越高
        let score = 0
        if (idx === 0) score = 100
        else if (idx > 0) score = 60 - Math.min(idx, 40)
        if (score > 0 && item.archived) score -= 15
        return { ...item, score }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  }, [sessions, archivedSessions, q])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 关键词变化时把光标拉回顶部
  useEffect(() => {
    setCursor(0)
  }, [q])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // 归档会话在搜索中不可直接打开（归档浏览通过官方 UI 注入面板），活跃会话正常切换
  const commit = (r: { s: SessionSummary; archived: boolean }) => {
    if (!r.archived) onSelect(r.s.sessionId)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (results.length ? (c + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[cursor]
      if (target) commit(target)
      else {
        // 无匹配时回车 = 直接新建会话（对齐 Alma 的空态行为）
        onNewChat()
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="search-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-palette-input">
          <IconSearch size={16} className="search-palette-icon" />
          <input
            ref={inputRef}
            className="search-palette-field"
            placeholder="搜索会话…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="search-palette-clear" onClick={onClose} title="关闭 (Esc)">
            <IconClose size={14} />
          </button>
        </div>

        <div className="search-palette-body" ref={listRef}>
          {results.length === 0 ? (
            <div className="search-empty">
              {q ? (
                <>
                  没有匹配「{query.trim()}」的会话
                  <button className="search-empty-action" onClick={() => { onNewChat(); onClose(); }}>
                    新建会话
                  </button>
                </>
              ) : (
                '还没有会话'
              )}
            </div>
          ) : (
            results.map((r, i) => {
              const s = r.s
              const title = s.title || '新会话'
              return (
                <button
                  key={s.sessionId}
                  data-idx={i}
                  className={`search-row ${i === cursor ? 'cursor' : ''} ${s.sessionId === activeId ? 'active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => commit(r)}
                >
                  <span className="session-indicator" aria-hidden>
                    {r.archived ? (
                      <span className="search-row-badge">归档</span>
                    ) : s.running ? (
                      <span className="session-spinner" />
                    ) : (
                      <IconChat size={14} className="search-row-icon" />
                    )}
                  </span>
                  <span className="search-row-title">
                    <Highlight text={title} query={q} />
                  </span>
                  <span className="search-row-meta">{formatTime(s.updatedAt)}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="search-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
