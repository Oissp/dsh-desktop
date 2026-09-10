import { describe, expect, it } from 'vitest'
import { foldTitleSnapshot } from '../title-snapshot'

const TTL = 7 * 24 * 60 * 60 * 1000

describe('foldTitleSnapshot', () => {
  const now = 1_000_000

  it('活跃会话标题写入快照并刷新 at', () => {
    const prev = { s1: { title: '旧', at: 0 } }
    const out = foldTitleSnapshot(prev, [{ sessionId: 's1', title: '新' }], now, TTL)
    expect(out.s1).toEqual({ title: '新', at: now })
  })

  it('不在活跃列表（已归档）的条目在 TTL 内保留', () => {
    const prev = { s1: { title: '标题', at: now - 10_000 } }
    const out = foldTitleSnapshot(prev, [{ sessionId: 's2', title: 'x' }], now, TTL)
    expect(out.s1).toEqual({ title: '标题', at: now - 10_000 })
    expect(out.s2).toEqual({ title: 'x', at: now })
  })

  it('超过 TTL 的条目被清理', () => {
    const prev = { s1: { title: '过期', at: now - TTL - 1 } }
    const out = foldTitleSnapshot(prev, [], now, TTL)
    expect(out.s1).toBeUndefined()
  })

  it('at 缺失按已过期处理（真实 epoch 下 age=now 必超 TTL）', () => {
    const prev = { s1: { title: '无时间戳', at: undefined as unknown as number } }
    const out = foldTitleSnapshot(prev, [], TTL + 1, TTL)
    expect(out.s1).toBeUndefined()
  })

  it('空 prev 正常', () => {
    const out = foldTitleSnapshot(undefined, [{ sessionId: 's1', title: 't' }], now, TTL)
    expect(out).toEqual({ s1: { title: 't', at: now } })
  })
})
