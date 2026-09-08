import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceFileNode } from '../../../shared/types'
import { fileLabel, fmtSize, fmtTime } from '../../../shared/workspace-format'

interface Props {
  /** 工作区根目录（未选择时为 null）。 */
  workspaceCwd: string | null
}

/** 单文件/目录行。 */
function TreeRow({
  node,
  depth,
  openDirs,
  onToggle,
  onOpen,
  activePath,
}: {
  node: WorkspaceFileNode
  depth: number
  openDirs: Set<string>
  onToggle: (path: string) => void
  onOpen: (node: WorkspaceFileNode) => void
  activePath: string | null
}) {
  const pad = { paddingLeft: `${8 + depth * 14}px` }
  const isOpen = node.isDir && openDirs.has(node.path)
  if (node.isDir) {
    return (
      <div className="ws-row" style={pad}>
        <button className="ws-row-btn" onClick={() => onToggle(node.path)} title={node.name}>
          <span className={`ws-caret ${isOpen ? 'open' : ''}`}>▸</span>
          <span className="ws-ic ws-ic-dir">📁</span>
          <span className="ws-name">{node.name}</span>
          {node.children && node.children.length > 0 && (
            <span className="ws-count">{node.children.length}</span>
          )}
        </button>
      </div>
    )
  }
  const active = node.path === activePath
  return (
    <div className="ws-row" style={pad}>
      <button
        className={`ws-row-btn ${active ? 'active' : ''}`}
        onClick={() => onOpen(node)}
        title={`${node.name}\n${fmtSize(node.size)} · ${fmtTime(node.mtime)}`}
      >
        <span className="ws-caret-spacer" />
        <span className="ws-ic ws-ic-file">📄</span>
        <span className="ws-name">{node.name}</span>
        <span className="ws-size">{fmtSize(node.size)}</span>
      </button>
    </div>
  )
}

/**
 * 工作区右侧面板（参考 Alma 会话右侧的 Artifact/工作区面板）：
 * 文件树（目录可展开）+ 点击文件预览内容。
 */
export default function WorkspacePanel({ workspaceCwd: cwd }: Props) {
  const [tree, setTree] = useState<WorkspaceFileNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ node: WorkspaceFileNode; content: string; truncated: boolean } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const loadTree = useCallback(async () => {
    if (!cwd) return
    setLoading(true)
    setError(null)
    try {
      const list = await window.__desktop__?.listWorkspace(cwd, { maxDepth: 3, limit: 800 })
      if (!list) {
        setError('IPC 调用失败')
        setTree([])
        return
      }
      setTree(list)
      if (list.length > 0) setOpenDirs(new Set([cwd]))
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    setPreview(null)
    void loadTree()
  }, [loadTree])

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const openFile = useCallback(async (node: WorkspaceFileNode) => {
    if (!cwd) return
    setPreviewLoading(true)
    try {
      const res = await window.__desktop__?.readWorkspaceFile(cwd, node.path)
      if (res) setPreview({ node, content: res.content, truncated: res.truncated })
      else setPreview({ node, content: '(无法读取该文件)', truncated: false })
    } catch (e) {
      setPreview({ node, content: `读取失败：${(e as Error).message}`, truncated: false })
    } finally {
      setPreviewLoading(false)
    }
  }, [cwd])

  // 目录逐层展开渲染
  const renderLevel = useMemo(() => {
    const render = (nodes: WorkspaceFileNode[] | undefined, depth: number): React.ReactNode => {
      if (!nodes) return null
      return nodes.map((n) => (
        <div key={n.path}>
          <TreeRow
            node={n}
            depth={depth}
            openDirs={openDirs}
            onToggle={toggleDir}
            onOpen={openFile}
            activePath={preview?.node.path ?? null}
          />
          {n.isDir && openDirs.has(n.path) && render(n.children, depth + 1)}
        </div>
      ))
    }
    return render
  }, [openDirs, toggleDir, openFile, preview])

  if (!cwd) {
    return (
      <div className="ws-panel">
        <div className="ws-header">
          <span>工作区</span>
          <span className="ws-tag">plugin</span>
        </div>
        <div className="ws-empty">
          <p>尚未选择工作区</p>
          <p className="ws-empty-hint">在设置 → 通用 → 工作区中指定目录后，这里会显示文件树。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ws-panel">
      <div className="ws-header">
        <span className="ws-title" title={cwd}>{cwd.split(/[/\\]/).pop() || cwd}</span>
        <span className="ws-tag">plugin</span>
        <button className="btn small ghost" onClick={() => void loadTree()} disabled={loading} title="刷新文件树">
          ↻
        </button>
      </div>

      <div className="ws-body">
        {error ? (
          <div className="ws-empty">
            <p className="ws-error">{error}</p>
            <button className="btn small secondary" onClick={() => void loadTree()}>重试</button>
          </div>
        ) : loading && !tree ? (
          <div className="ws-empty">加载文件树…</div>
        ) : tree && tree.length === 0 ? (
          <div className="ws-empty">
            <p>工作区为空</p>
          </div>
        ) : (
          <div className="ws-tree" role="tree" aria-label="工作区文件">
            {renderLevel(tree ?? [], 0)}
          </div>
        )}
      </div>

      {preview && (
        <div className="ws-preview">
          <div className="ws-preview-header">
            <span className="ws-preview-name" title={preview.node.path}>
              {preview.node.name}
            </span>
            <span className="ws-preview-meta">
              {fileLabel(preview.node.name)} · {fmtSize(preview.node.size)}
            </span>
            <button className="btn small ghost" onClick={() => setPreview(null)} title="关闭预览">✕</button>
          </div>
          <pre className="ws-preview-content">
            {previewLoading ? '加载中…' : preview.content}
          </pre>
          {preview.truncated && (
            <div className="ws-preview-note">文件过大，仅预览前 256 KB</div>
          )}
        </div>
      )}
    </div>
  )
}
