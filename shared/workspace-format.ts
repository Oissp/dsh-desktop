/**
 * shared/workspace-format.ts —— 工作区文件展示纯函数（renderer 与 preload 两侧共用）。
 *
 * 从 src/plugins/workspace/WorkspacePanel.tsx 抽出。
 */

/** 扩展名 → 简单语言标签（预览标题用）。 */
const EXT_LABEL: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', c: 'C', cpp: 'C++',
  sh: 'Shell', yml: 'YAML', yaml: 'YAML', toml: 'TOML', txt: 'Text',
  xml: 'XML', sql: 'SQL', vue: 'Vue', svelte: 'Svelte',
}

/** 文件名 → 语言标签（无扩展名归类为 Text）。 */
export function fileLabel(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0) return 'Text'
  return EXT_LABEL[name.slice(i + 1).toLowerCase()] ?? name.slice(i + 1).toUpperCase()
}

/** 字节数 → 人类可读大小（B / KB / MB）。 */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 毫秒时间戳 → 当天用时刻、否则用日期。 */
export function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}