/**
 * shared/usage-format.ts —— 用量统计纯函数（renderer 与 preload 两侧共用）。
 *
 * 从 src/plugins/usage/UsageStore.ts、UsageSection.tsx 抽出，避免在
 * preload.ts（tsconfig.electron.json 单独编译）与 renderer 侧各自维护一份。
 * 纯函数、无外部依赖，两边都能直接 import。
 */
import type { UsageData, UsageDay } from './types.js'

/** 本地时区日期键：YYYY-MM-DD。 */
export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 汇总：全量 / 今日 / 本周（周一为一周起点）/ 本月（自然月）。纯函数，由面板按 UsageData 派生。 */
export function summarizeUsage(data: UsageData): {
  total: UsageDay
  today: UsageDay
  week: UsageDay
  month: UsageDay
} {
  const now = new Date()
  const todayKey = dayKey(now.getTime())
  // 本周起点：周一 00:00
  const dow = (now.getDay() + 6) % 7 // 0=周一
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
  const weekStartKey = dayKey(weekStart.getTime())

  // 本月前缀：本地时区 YYYY-MM（与 dayKey 格式一致）
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const zero = (): UsageDay => ({
    date: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    turns: 0,
    tools: 0,
  })
  const add = (target: UsageDay, d: UsageDay) => {
    target.inputTokens += d.inputTokens
    target.outputTokens += d.outputTokens
    target.cacheReadTokens += d.cacheReadTokens
    target.cacheWriteTokens += d.cacheWriteTokens
    target.reasoningTokens += d.reasoningTokens
    target.turns += d.turns
    target.tools += d.tools
  }
  const total = zero()
  const today = zero()
  const week = zero()
  const month = zero()
  for (const [date, d] of Object.entries(data.days)) {
    add(total, d)
    if (date === todayKey) add(today, d)
    if (date >= weekStartKey) add(week, d)
    if (date.startsWith(monthKey)) add(month, d)
  }
  return { total, today, week, month }
}

/** 最近 n 天（含无数据的天，方便画柱状条）。纯函数。 */
export function recentUsageDays(data: UsageData, n: number): UsageDay[] {
  const out: UsageDay[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d.getTime())
    out.push(
      data.days[key] ?? {
        date: key,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        turns: 0,
        tools: 0,
      },
    )
  }
  return out
}

/** 数字格式化：1.2k / 3.4m。 */
export function fmt(n: number): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}