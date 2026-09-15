import { describe, expect, it } from 'vitest'
import { drainPurged, type UnarchiveTarget } from '../archive-cleanup'

/** 记录调用并按需失败的假 adapter。 */
function fakeTarget(failing = new Set<string>()): UnarchiveTarget & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async unarchiveSession(sessionId: string) {
      calls.push(sessionId)
      if (failing.has(sessionId)) throw new Error('引擎瞬时不可用')
    },
  }
}

describe('drainPurged', () => {
  it('引擎已遗忘的 id 被取消归档', async () => {
    const target = fakeTarget()
    const drained = await drainPurged(target, new Set(['other']), ['gone'])
    expect(drained).toEqual(['gone'])
    expect(target.calls).toEqual(['gone'])
  })

  it('引擎仍持有（live）的 id 绝不取消归档——否则会话会复活到活跃列表', async () => {
    const target = fakeTarget()
    const drained = await drainPurged(target, new Set(['live']), ['live'])
    expect(drained).toEqual([])
    expect(target.calls).toEqual([])
  })

  it('混合队列只摘已遗忘的，保持队列顺序', async () => {
    const target = fakeTarget()
    const drained = await drainPurged(target, new Set(['b']), ['a', 'b', 'c'])
    expect(drained).toEqual(['a', 'c'])
    expect(target.calls).toEqual(['a', 'c'])
  })

  it('单个 id 失败不抛出，也不计入已摘——留在队列下轮再试', async () => {
    const target = fakeTarget(new Set(['bad']))
    const drained = await drainPurged(target, new Set(), ['bad', 'ok'])
    expect(drained).toEqual(['ok'])
    expect(target.calls).toEqual(['bad', 'ok'])
  })

  it('空队列与空 activeIds 不报错', async () => {
    const target = fakeTarget()
    expect(await drainPurged(target, new Set(), [])).toEqual([])
    expect(await drainPurged(target, new Set(), ['x'])).toEqual(['x'])
  })
})