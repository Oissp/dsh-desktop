/**
 * electron/__tests__/quit-confirmation.test.ts —— 退出确认的判定与调度。
 *
 * 这段逻辑只在用户点"退出"时跑，而且它的**错误方向不对称**：判成"没任务"会把
 * 正在跑的回合静默掐掉（用户丢工作且毫不知情），判成"有任务"只是多一个弹窗。
 * 所以这里逐条钉住每个失败模式都倒向保守的一侧，以及"一次只弹一个框"。
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import {
  QuitConfirmation,
  inspectQuitState,
  resolveQuitPrompt,
  type QuitInspection,
} from '../quit-confirmation.js'

const answer = (response: number): MessageBoxReturnValue =>
  ({ response, checkboxChecked: false }) as MessageBoxReturnValue

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 把微任务队列跑空：decide() 里 await inspect 之后才弹框。 */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

const IDLE: QuitInspection = { kind: 'idle', activeSessions: 0 }

describe('inspectQuitState', () => {
  it('没有 running 会话 → idle', async () => {
    await expect(
      inspectQuitState(async () => [{ running: false }, { running: false }]),
    ).resolves.toEqual(IDLE)
  })

  it('有 running 会话 → active 并计数', async () => {
    await expect(
      inspectQuitState(async () => [{ running: true }, { running: false }, { running: true }]),
    ).resolves.toEqual({ kind: 'active', activeSessions: 2 })
  })

  it('查询抛错 → unknown（不是 idle：抛错不等于没任务）', async () => {
    const result = await inspectQuitState(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(result.kind).toBe('unknown')
    expect(result).toMatchObject({ reason: 'ECONNREFUSED' })
  })

  it('超时 → unknown（引擎正忙恰恰可能意味着有任务在跑，不能当空闲）', async () => {
    const result = await inspectQuitState(() => new Promise(() => {}), 30)
    expect(result.kind).toBe('unknown')
  })

  it('超时判定在时限内落定，不会被挂起的查询拖住', async () => {
    const started = Date.now()
    await inspectQuitState(() => new Promise(() => {}), 30)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('resolveQuitPrompt', () => {
  it('idle → 不弹框（没东西可打断，不打扰用户）', () => {
    expect(resolveQuitPrompt(IDLE)).toBeNull()
  })

  it('active → 文案含会话数，并说明未完成回合不会保留', () => {
    const prompt = resolveQuitPrompt({ kind: 'active', activeSessions: 3 })
    expect(prompt?.message).toContain('仍有任务')
    expect(prompt?.detail).toContain('3 个会话')
    expect(prompt?.detail).toContain('未完成的回合不会保留')
  })

  it('unknown → 文案说明"无法确认"，并带上原因', () => {
    const prompt = resolveQuitPrompt({ kind: 'unknown', reason: '引擎会话状态查询超时（2000ms）' })
    expect(prompt?.message).toContain('无法确认')
    expect(prompt?.detail).toContain('查询超时')
  })
})

describe('QuitConfirmation — 判定', () => {
  it('idle 时直接放行，完全不弹框、不打扰', async () => {
    const show = vi.fn()
    const quit = new QuitConfirmation({ inspect: async () => IDLE, show })
    await expect(quit.confirm()).resolves.toBe(true)
    expect(show).not.toHaveBeenCalled()
  })

  it('active + 用户点"退出" → 放行', async () => {
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'active', activeSessions: 1 }),
      show: async () => answer(0),
    })
    await expect(quit.confirm()).resolves.toBe(true)
  })

  it('active + 用户点"取消" → 不放行', async () => {
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'active', activeSessions: 1 }),
      show: async () => answer(1),
    })
    await expect(quit.confirm()).resolves.toBe(false)
  })

  it('默认按钮落在"取消"——框只在会丢工作时出现，误按回车不能掐掉回合', async () => {
    let seen: MessageBoxOptions | undefined
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'active', activeSessions: 1 }),
      show: async (options) => {
        seen = options
        return answer(1)
      },
    })
    await quit.confirm()
    expect(seen?.buttons).toEqual(['退出', '取消'])
    expect(seen?.defaultId).toBe(1)
    expect(seen?.cancelId).toBe(1)
    expect(seen?.noLink).toBe(true)
  })

  it('unknown 也会弹框（保守方向）', async () => {
    const show = vi.fn(async () => answer(1))
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'unknown', reason: 'boom' }),
      show,
    })
    await expect(quit.confirm()).resolves.toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('用户点了"退出"不复查：决定只做一次', async () => {
    const inspect = vi.fn(async () => ({ kind: 'active' as const, activeSessions: 1 }))
    const quit = new QuitConfirmation({ inspect, show: async () => answer(0) })
    await quit.confirm()
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})

describe('QuitConfirmation — 一次只做一个决定', () => {
  it('框开着时重复请求 join 同一个 Promise，只弹一个框', async () => {
    const dialog = deferred<MessageBoxReturnValue>()
    const show = vi.fn(() => dialog.promise)
    const inspect = vi.fn(async () => ({ kind: 'active' as const, activeSessions: 1 }))
    const quit = new QuitConfirmation({ inspect, show })

    const first = quit.confirm()
    // decide() 先 await inspect 才弹框，等它落到弹框那一刻
    await flush()
    expect(show).toHaveBeenCalledTimes(1)

    // 框开着（dialog 未作答）时再点两次退出
    const second = quit.confirm()
    const third = quit.confirm()
    await flush()
    expect(show).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledTimes(1)

    dialog.resolve(answer(0))
    await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true])
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('上一轮结束后，新的请求重新做一次判定（用户改了主意又点退出）', async () => {
    const inspect = vi.fn(async () => IDLE)
    const quit = new QuitConfirmation({ inspect, show: async () => answer(1) })
    await quit.confirm()
    await quit.confirm()
    expect(inspect).toHaveBeenCalledTimes(2)
  })
})

describe('QuitConfirmation — dispose（被不需要询问的退出路径抢先）', () => {
  it('dispose 之后 confirm 立刻返回 false，且不再弹框', async () => {
    const show = vi.fn()
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'active', activeSessions: 1 }),
      show,
    })
    quit.dispose()
    await expect(quit.confirm()).resolves.toBe(false)
    expect(show).not.toHaveBeenCalled()
  })

  it('框已开着时被 dispose：即使用户点了"退出"也不放行', async () => {
    const dialog = deferred<MessageBoxReturnValue>()
    const quit = new QuitConfirmation({
      inspect: async () => ({ kind: 'active', activeSessions: 1 }),
      show: () => dialog.promise,
    })
    const pending = quit.confirm()
    quit.dispose()
    dialog.resolve(answer(0))
    // 另一条路径已经在退出了，这里必须让位（false），否则会出现两次退出流程
    await expect(pending).resolves.toBe(false)
  })

  it('inspect 尚未回来时被 dispose：不弹框，直接 false', async () => {
    const dialog = deferred<QuitInspection>()
    const show = vi.fn()
    const quit = new QuitConfirmation({ inspect: () => dialog.promise, show })
    const pending = quit.confirm()
    quit.dispose()
    dialog.resolve({ kind: 'active', activeSessions: 1 })
    await expect(pending).resolves.toBe(false)
    expect(show).not.toHaveBeenCalled()
  })

  it('dispose 是幂等的', () => {
    const quit = new QuitConfirmation({ inspect: async () => IDLE, show: async () => answer(0) })
    quit.dispose()
    quit.dispose()
    expect(true).toBe(true)
  })
})
