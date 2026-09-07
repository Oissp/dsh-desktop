/**
 * UsageStore —— 用量统计（usage 插件内部）。
 *
 * 与 TaskStore 同构：从会话事件流（turn-end 的 usage 字段、tool-call、assistant-end）
 * 推导用量，按天聚合，并持久化到 AppSettings.usage。
 * 不请求引擎额外 API，纯本地统计，跨启动保留。
 */
import type { SessionStreamEvent, UsageData, UsageDay } from '../../../shared/types'
import { subscribeAll } from '../../bus'

const MAX_DAYS = 90

/** 本地时区日期键：YYYY-MM-DD。 */
export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export class UsageStore {
  private data: UsageData = { days: {} }
  private listeners = new Set<(d: UsageData) => void>()

  constructor(private readonly persist: (next: UsageData) => void) {}

  /** 从持久化数据加载。 */
  load(saved?: UsageData) {
    this.data = { days: { ...(saved?.days ?? {}) } }
    this.prune()
  }

  subscribe(cb: (d: UsageData) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit() {
    for (const cb of this.listeners) cb(this.data)
  }

  /** 逐日淘汰超过 MAX_DAYS 的旧数据。 */
  private prune() {
    const keys = Object.keys(this.data.days).sort()
    while (keys.length > MAX_DAYS) {
      delete this.data.days[keys.shift()!]
    }
  }

  /** 订阅事件流并就地更新（在组件里挂载/卸载）。 */
  attach(): () => void {
    const unsub = subscribeAll((evt: SessionStreamEvent) => {
      this.handleEvent(evt)
    })
    return unsub
  }

  handleEvent(evt: SessionStreamEvent) {
    const day = dayKey()
    const cur = this.data.days[day] ?? {
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
      this.data.days[day] = cur
      // 数据仍在同一对象上：避免高频 commit 时 React 不感知（emit 用新引用）
      this.persist(this.data)
      this.emit()
    }
  }

  get dataSnapshot(): UsageData {
    return this.data
  }
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
