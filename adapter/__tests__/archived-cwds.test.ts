/**
 * adapter/__tests__/archived-cwds.test.ts —— 归档会话 cwd 解析。
 *
 * 回归背景：硬删除靠 cwd 定位 `sessions/<projectKey(cwd)>/<sessionId>` 日志目录。
 * 早先只从 workspace/follow baseline 的 items[].sessionIds 反查，而那是**工作区
 * 成员表**——桌面向导用 `session/create {cwd}`（不带 workspaceId）建的会话永远
 * 不是成员，cwd 解析成 undefined，硬删删到 `sessions/_no-cwd` 去，真实目录留在
 * 磁盘上。session/list 的会话摘要自带权威 cwd，必须优先采用。
 */
import { describe, expect, it } from 'vitest'
import { archivedCwds } from '../index'
import type { SessionSummary } from '../../shared/types'

/** 造一个只含 cwd 相关的会话摘要。 */
function summary(sessionId: string, cwd?: string): SessionSummary {
  return { sessionId, title: '', updatedAt: 0, running: false, blank: false, cwd }
}

/** 造一个 workspace/follow baseline。 */
function baseline(items: Array<{ path?: unknown; sessionIds?: unknown }>): Record<string, unknown> {
  return { items }
}

describe('adapter/archivedCwds', () => {
  it('工作区成员表给出成员会话的 cwd', () => {
    const map = archivedCwds(
      baseline([{ path: '/work/repo', sessionIds: ['s1', 's2'] }]),
      [],
    )
    expect(map.get('s1')).toBe('/work/repo')
    expect(map.get('s2')).toBe('/work/repo')
  })

  it('非工作区成员靠会话摘要拿到 cwd（回归：向导建的会话）', () => {
    // 工作区里没有 s3 —— 正是 session/create {cwd} 不带 workspaceId 的情形
    const map = archivedCwds(
      baseline([{ path: '/work/repo', sessionIds: ['s1'] }]),
      [summary('s3', '/tmp/scratch')],
    )
    expect(map.get('s1')).toBe('/work/repo')
    expect(map.get('s3')).toBe('/tmp/scratch')
  })

  it('两个来源都有时摘要优先（摘要的 cwd 与落盘规则同源）', () => {
    const map = archivedCwds(
      baseline([{ path: '/work/repo', sessionIds: ['s1'] }]),
      [summary('s1', '/work/repo/.worktrees/feature')],
    )
    expect(map.get('s1')).toBe('/work/repo/.worktrees/feature')
  })

  it('摘要 cwd 缺失时不覆盖成员表结果', () => {
    const map = archivedCwds(
      baseline([{ path: '/work/repo', sessionIds: ['s1'] }]),
      [summary('s1', undefined)],
    )
    expect(map.get('s1')).toBe('/work/repo')
  })

  it('两个来源都没有的会话不在 map 里（硬删退回 _no-cwd）', () => {
    const map = archivedCwds(baseline([{ path: '/work/repo', sessionIds: ['s1'] }]), [summary('s9')])
    expect(map.has('s9')).toBe(false)
  })

  it('畸形 baseline 不抛错：缺 path / 缺 sessionIds / 非字符串 id 一律跳过', () => {
    const map = archivedCwds(
      baseline([
        { sessionIds: ['s1'] }, // 缺 path
        { path: '/work/a' }, // 缺 sessionIds
        { path: '/work/b', sessionIds: ['ok', 42, null] }, // 混入非字符串
        { path: 7, sessionIds: ['s2'] }, // path 非字符串
      ]),
      [],
    )
    expect(map.get('ok')).toBe('/work/b')
    expect(map.size).toBe(1)
  })

  it('items 缺失时只靠摘要', () => {
    const map = archivedCwds({}, [summary('s1', '/tmp/x')])
    expect(map.get('s1')).toBe('/tmp/x')
  })
})
