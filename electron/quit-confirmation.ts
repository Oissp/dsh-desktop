/**
 * electron/quit-confirmation.ts —— 退出前确认"有没有正在跑的会话"。
 *
 * 借鉴上游 apps/desktop 的 quit-confirmation.ts。之前托盘菜单的"退出"是**无条件**
 * 立刻杀引擎：用户点一下，正在跑的回合、正在生成的回复、正在执行的工具调用全部
 * 无声中断，且没有任何提示。引擎侧有 `session.list` 的 `running` 字段可以判定
 * （见 adapter listSessions），所以这件事在桌面端就能做对。
 *
 * 与上游的差异：上游走的是进程内 Cordis 的 `workspace/session-activity`，能区分
 * 「活跃任务」与「已排期的任务」（scheduled）；Typert Remote 只暴露 `running`，
 * 所以这里只有一档文案。上游的 `focus()`（把已打开的框提到最前）也去掉了——
 * 我们用不带 owner window 的原生框，拿不到句柄，Windows 专属的 task dialog 焦点
 * API 在 Linux 上也没有对应物。
 */
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'

/** 确认框弹出来之前，等待引擎回答"有没有任务在跑"的上限。 */
export const QUIT_INSPECTION_TIMEOUT_MS = 2_000

/** 引擎任务状态的一次判定结果。 */
export type QuitInspection =
  | { kind: 'idle'; activeSessions: 0 }
  | { kind: 'active'; activeSessions: number }
  | { kind: 'unknown'; reason: string }

/**
 * 询问引擎是否有正在运行的会话。
 *
 * 关键取舍：**每个失败模式都归到 'unknown'，绝不归到 'idle'。** 多弹一次确认框的
 * 成本是一个弹窗；判成 idle 的成本是静默杀掉用户正在跑的回合——两者不对称。
 * 同理超时也走 unknown：2 秒不回答往往意味着引擎正忙，而"正忙"恰恰是有任务在跑的
 * 信号，把超时当作空闲正好把因果关系判反。
 */
export async function inspectQuitState(
  listSessions: () => Promise<{ running: boolean }[]>,
  timeoutMs: number = QUIT_INSPECTION_TIMEOUT_MS,
): Promise<QuitInspection> {
  let sessions: { running: boolean }[]
  try {
    sessions = await withDeadline(listSessions(), timeoutMs)
  } catch (err) {
    return { kind: 'unknown', reason: err instanceof Error ? err.message : String(err) }
  }
  const active = sessions.filter((s) => s.running).length
  return active > 0
    ? { kind: 'active', activeSessions: active }
    : { kind: 'idle', activeSessions: 0 }
}

/** 确认框文案。null = 没有会中断的东西，直接退出、不打扰用户。 */
export interface QuitPrompt {
  message: string
  detail: string
}

export function resolveQuitPrompt(inspection: QuitInspection): QuitPrompt | null {
  if (inspection.kind === 'idle') return null
  if (inspection.kind === 'active') {
    return {
      message: '仍有任务正在运行',
      detail: `${String(inspection.activeSessions)} 个会话正在运行。退出会立即中断它们，未完成的回合不会保留。确定要退出吗？`,
    }
  }
  return {
    message: '无法确认是否仍有任务在运行',
    detail: `未能从引擎取得会话状态（${inspection.reason}）。退出可能中断正在进行的会话。确定要退出吗？`,
  }
}

export interface QuitConfirmationDeps {
  /** 判定当前是否有任务在跑。 */
  inspect: () => Promise<QuitInspection>
  /** 弹原生框。收到 MessageBoxOptions、返回用户选择。 */
  show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
}

/**
 * 一次只做一个退出决定：确认框开着时重复的退出请求 join 同一个 Promise，
 * 不会叠出第二个框（托盘"退出"连点、或托盘 + Cmd+Q 同时来）。
 */
export class QuitConfirmation {
  private pending: Promise<boolean> | undefined
  private disposed = false

  constructor(private readonly deps: QuitConfirmationDeps) {}

  /**
   * 判定这次退出是否可以继续。
   * 检查只做一次：框开着的时候有任务开始或结束都不改变文案，用户点了"退出"也不复查
   * ——复查只会让"确定"变成"再想想"，把决定权从用户手里拿走。
   *
   * @returns true = 可以退出；false = 用户取消，或已被 dispose（有别的路径抢先退出）
   */
  confirm(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.pending !== undefined) return this.pending
    const pending = this.decide().finally(() => {
      // 只清掉自己这一份：dispose 后可能有新一轮 confirm 已经占了槽位
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }

  /**
   * 应用正走一条**不需要询问**的退出路径（更新安装完成、SIGTERM 被登出流程发出）。
   * 此后所有 confirm 立刻返回 false，已经打开的框随进程一起消失（原生框没有关闭 API）。
   */
  dispose(): void {
    this.disposed = true
  }

  private async decide(): Promise<boolean> {
    const prompt = resolveQuitPrompt(await this.deps.inspect())
    if (this.disposed) return false
    if (prompt === null) return true
    const result = await this.deps.show({
      type: 'warning',
      title: 'DSH Desktop',
      message: prompt.message,
      detail: prompt.detail,
      buttons: ['退出', '取消'],
      // 与上游不同：上游默认落在"退出"（用户本来就点了退出，框只是告知）。
      // 这里默认落在"取消"——框只在**会丢工作**时出现，误按回车的代价是掐掉正在跑的
      // 回合，而多按一次"退出"的代价只是再点一下，两者不对称。
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (this.disposed) return false
    return result.response === 0
  }
}

/** 取 listSessions + 截止时限。超时抛错，由调用方归入 'unknown'。 */
function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`引擎会话状态查询超时（${String(timeoutMs)}ms）`)),
      timeoutMs,
    )
    // 退出路径上不能因为一个计时器把事件循环钉住
    timer.unref()
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}
