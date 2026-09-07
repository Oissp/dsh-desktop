import { describe, expect, it, vi } from 'vitest'
import { UsageStore, dayKey, recentUsageDays, summarizeUsage } from './UsageStore'
import type { SessionStreamEvent, UsageDay } from '../../../shared/types'

function evt(partial: Partial<SessionStreamEvent> & { kind: SessionStreamEvent['kind'] }): SessionStreamEvent {
  return { sessionId: 's1', seq: 0, ...partial } as SessionStreamEvent
}

describe('UsageStore', () => {
  it('dayKey 输出 YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 8, 7, 15, 30).getTime())).toBe('2026-09-07')
  })

  it('turn-end 的 usage 累加 input/output/缓存/推理 token 并计回合', () => {
    const persist = vi.fn()
    const store = new UsageStore(persist)
    store.handleEvent(evt({
      kind: 'turn-end',
      turn: 1,
      time: 1,
      usage: { inputTokens: 100, outputTokens: 250, cacheReadTokens: 40, cacheWriteTokens: 10, reasoningTokens: 60 },
    }))
    store.handleEvent(evt({ kind: 'turn-end', turn: 2, time: 2, usage: { inputTokens: 50, outputTokens: 30 } }))
    const day = store.dataSnapshot.days[dayKey()]
    expect(day.inputTokens).toBe(150)
    expect(day.outputTokens).toBe(280)
    expect(day.cacheReadTokens).toBe(40)
    expect(day.cacheWriteTokens).toBe(10)
    expect(day.reasoningTokens).toBe(60)
    expect(day.turns).toBe(2)
  })

  it('tool-call 计数', () => {
    const store = new UsageStore(() => {})
    store.handleEvent(evt({ kind: 'tool-call', callId: 'c1', name: 'bash', arguments: 'x' }))
    store.handleEvent(evt({ kind: 'tool-call', callId: 'c2', name: 'read', arguments: 'y' }))
    expect(store.dataSnapshot.days[dayKey()].tools).toBe(2)
  })

  it('无 usage 字段的 turn-end 只计回合', () => {
    const store = new UsageStore(() => {})
    store.handleEvent(evt({ kind: 'turn-end', turn: 1, time: 1 }))
    const day = store.dataSnapshot.days[dayKey()]
    expect(day.turns).toBe(1)
    expect(day.inputTokens).toBe(0)
    expect(day.outputTokens).toBe(0)
  })

  it('summary 区分 今日/本周/全部', () => {
    const store = new UsageStore(() => {})
    // 今天
    store.handleEvent(evt({ kind: 'turn-end', turn: 1, time: 1, usage: { inputTokens: 100, outputTokens: 100 } }))
    // 昨天（写回持久化后再造一条不同日期，需直接注入）
    const yKey = dayKey(Date.now() - 86400000)
    store.load({
      days: {
        ...store.dataSnapshot.days,
        [yKey]: { date: yKey, inputTokens: 50, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, turns: 1, tools: 0 },
      },
    })
    const s = summarizeUsage(store.dataSnapshot)
    expect(s.today.turns).toBe(1)
    // 今天可能是周一（本周起点），本周统计只保证 >= 今日
    expect(s.week.turns).toBeGreaterThanOrEqual(1)
    expect(s.total.turns).toBe(2)
    expect(s.total.inputTokens).toBe(150)
  })

  it('recentDays 补零天数且长度固定', () => {
    const store = new UsageStore(() => {})
    const days = recentUsageDays(store.dataSnapshot, 7)
    expect(days).toHaveLength(7)
    expect(days.every((d: { inputTokens: number }) => d.inputTokens === 0)).toBe(true)
  })

  it('超过 90 天自动裁剪', () => {
    const store = new UsageStore(() => {})
    const days: Record<string, UsageDay> = {}
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 100; i++) {
      const d = new Date(base + i * 86400000)
      const key = dayKey(d.getTime())
      days[key] = { date: key, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, turns: 1, tools: 1 }
    }
    store.load({ days })
    expect(Object.keys(store.dataSnapshot.days).length).toBe(90)
  })
})
