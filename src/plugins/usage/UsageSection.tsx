import { useMemo, useState } from 'react'
import type { UsageData, UsageDay } from '../../../shared/types'
import { recentUsageDays, summarizeUsage } from './UsageStore'
import type { PluginContext } from '../types'

/** 时间范围（对齐 Alma usage 面板的周期选择，默认本月）。 */
type Range = 'today' | 'week' | 'month' | 'all'
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '全部' },
]

/** 数字格式化：1.2k / 3.4m。 */
function fmt(n: number): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="usage-stat">
      <div className="usage-stat-value">{value}</div>
      <div className="usage-stat-label">{label}</div>
      {sub && <div className="usage-stat-sub">{sub}</div>}
    </div>
  )
}

function DayBars({ days }: { days: UsageDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens + d.cacheReadTokens))
  return (
    <div className="usage-bars" aria-label="最近 7 天 token 用量">
      {days.map((d) => {
        const total = d.inputTokens + d.outputTokens + d.cacheReadTokens
        const h = total ? Math.max(4, Math.round((total / max) * 56)) : 2
        const label = `${d.date}：输出 ${fmt(d.outputTokens)} / 输入 ${fmt(d.inputTokens)} / 缓存读 ${fmt(d.cacheReadTokens)}`
        const inPct = (d.inputTokens / Math.max(1, total)) * 100
        const outPct = (d.outputTokens / Math.max(1, total)) * 100
        return (
          <div key={d.date} className="usage-bar-col" title={label}>
            <div className="usage-bar-track">
              <div className="usage-bar" style={{ height: h }}>
                <div className="usage-bar-out" style={{ height: `${outPct}%` }} />
                <div className="usage-bar-in" style={{ height: `${inPct}%` }} />
              </div>
            </div>
            <div className="usage-bar-date">{d.date.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}

function fmtDateRange(days: UsageDay[]): string {
  const valid = days.filter((d) => d.turns > 0 || d.inputTokens > 0 || d.outputTokens > 0)
  if (valid.length === 0) return '暂无数据'
  const first = valid[0].date
  const last = valid[valid.length - 1].date
  return first === last ? first : `${first} ~ ${last}`
}

/**
 * 用量面板（参考 Alma 设置里的 Usage section）：
 * 总览卡片（总 token / 输入 / 输出 / 回合 / 工具调用）+ 今日/本周/全部 汇总 + 最近 7 天柱状条。
 */
export default function UsageSection({ ctx }: { ctx: PluginContext }) {
  // 数据由 MainView 里的全局 UsageStore 持续累计（应用启动即开始），
  // 这里只做纯展示，随 appSettings.usage 变化响应式更新。
  const data: UsageData = ctx.appSettings.usage ?? { days: {} }
  const [range, setRange] = useState<Range>('month')

  const summary = useMemo(() => summarizeUsage(data), [data])
  const recent = useMemo(() => recentUsageDays(data, 7), [data])

  // 当前范围对应的聚合（total/today/week/month 之一）
  const cur: UsageDay = useMemo(() => {
    if (range === 'today') return summary.today
    if (range === 'week') return summary.week
    if (range === 'month') return summary.month
    return summary.total
  }, [range, summary])
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? ''
  const hasData = summary.total.turns > 0 || summary.total.inputTokens > 0

  return (
    <div className="usage-plugin">
      {!hasData ? (
        <div className="hint">
          暂无用量数据。会话完成（turn-end）后会自动累计 token 与工具调用，数据保存在本地。
        </div>
      ) : (
        <>
          <div className="usage-toolbar">
            <span className="usage-title">用量概览</span>
            <div className="usage-range" role="group" aria-label="时间范围">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`usage-range-btn ${range === r.key ? 'active' : ''}`}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="usage-stats">
            <StatCard
              label={`${rangeLabel} Token`}
              value={fmt(cur.inputTokens + cur.outputTokens + cur.cacheReadTokens + cur.cacheWriteTokens)}
              sub="计费口径（含缓存）"
            />
            <StatCard label="输入 Token" value={fmt(cur.inputTokens)} sub="未缓存" />
            <StatCard label="输出 Token" value={fmt(cur.outputTokens)} />
            <StatCard label="缓存读取" value={fmt(cur.cacheReadTokens)} />
            <StatCard label="缓存写入" value={fmt(cur.cacheWriteTokens)} />
            <StatCard label="推理 Token" value={fmt(cur.reasoningTokens)} />
            <StatCard label="回合数" value={String(cur.turns)} />
            <StatCard label="工具调用" value={String(cur.tools)} />
          </div>

          <h4 className="usage-title">最近 7 天</h4>
          <DayBars days={recent} />
          <div className="usage-meta">
            统计区间：{fmtDateRange(recent)} · 今日 {fmt(summary.today.inputTokens + summary.today.outputTokens)} tokens · 缓存读不计费 · 保留最近 90 天
          </div>
        </>
      )}
      <div className="usage-foot">
        <span className="usage-foot-tag">plugin</span>
        <span>usage</span>
      </div>
    </div>
  )
}
