import { describe, expect, it } from 'vitest'
import { drainPurged, hideForHardDelete, type HardDeleteTarget, type UnarchiveTarget } from '../archive-cleanup'

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

/** 记录归档/取消调用与选项的假 adapter；archiveFails 时归档一律抛错。 */
function fakeHardDeleteTarget(archiveFails = false) {
  const archiveCalls: Array<{ sessionId: string; options?: { stopActivity?: boolean } }> = []
  const cancelCalls: string[] = []
  const target: HardDeleteTarget = {
    async archiveSession(sessionId, options) {
      archiveCalls.push({ sessionId, options })
      if (archiveFails) throw new Error('引擎拒绝归档')
    },
    async cancelTurn(sessionId) {
      cancelCalls.push(sessionId)
    },
  }
  return { target, archiveCalls, cancelCalls }
}

describe('hideForHardDelete', () => {
  it('归档必须带 stopActivity:true——否则运行中的会话会被引擎拒绝归档，硬删静默失败', async () => {
    const { target, archiveCalls } = fakeHardDeleteTarget()
    expect(await hideForHardDelete(target, 's1')).toBe(true)
    expect(archiveCalls).toEqual([{ sessionId: 's1', options: { stopActivity: true } }])
  })

  it('归档成功即不再单独取消回合（引擎已代为请求停掉）', async () => {
    const { target, cancelCalls } = fakeHardDeleteTarget()
    await hideForHardDelete(target, 's1')
    expect(cancelCalls).toEqual([])
  })

  it('归档失败返回 false 并兜底取消回合，不抛出', async () => {
    const { target, cancelCalls } = fakeHardDeleteTarget(true)
    expect(await hideForHardDelete(target, 's1')).toBe(false)
    expect(cancelCalls).toEqual(['s1'])
  })

  it('归档与取消都失败也不抛出（硬删尽力而为）', async () => {
    const target: HardDeleteTarget = {
      async archiveSession() {
        throw new Error('归档挂了')
      },
      async cancelTurn() {
        throw new Error('取消失败：未运行')
      },
    }
    expect(await hideForHardDelete(target, 's1')).toBe(false)
  })
})

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