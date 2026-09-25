/**
 * adapter/index.ts —— 高层的稳定 API。
 *
 * 主进程通过这个类访问 dsh 的全部能力。dsh 上游变更只会影响
 * DshClient（dsh-client.ts）与 normalize*（events.ts），本文件尽量薄。
 */
import { DshClient } from './dsh-client.js'
import { normalizeHistory } from './events.js'
import type { DshEvent } from './events.js'
import type {
  ArchivedSessionInfo,
  MessageBlock,
  ModelGroup,
  SessionStreamEvent,
  SessionSummary,
} from '../shared/types.js'

export class DshAdapter {
  readonly client: DshClient

  constructor(port: number) {
    this.client = new DshClient(port)
  }

  /** 注入引擎版本（dsh package.json），describe 用。 */
  setVersion(version: string | null) {
    this.client.setVersion(version)
  }

  // ---- 生命周期 ----

  /** 就绪探测：认证完成 + 一次认证请求成功即视为就绪。 */
  async isReady(): Promise<boolean> {
    return this.client.probeReady()
  }

  describe(): Promise<{
    version: string | null
    cwd: string | null
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }> {
    return this.client.describeHost()
  }

  // ---- 会话 ----

  async listSessions(): Promise<SessionSummary[]> {
    const { items } = await this.client.listSessions()
    // 去重：引擎可能因订阅/列表竞态返回重复 sessionId
    const seen = new Set<string>()
    return items
      .filter((raw) => {
        const id = String((raw as Record<string, unknown>).sessionId ?? '')
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((raw) => {
        const s = raw as Record<string, unknown>
        // title / agentPreset 在 projections.values 里（值可能为 null 或字符串）
        const proj = (s.projections as { values?: Record<string, unknown> } | undefined)?.values
        const projTitle = proj?.title
        const resolvedTitle =
          typeof projTitle === 'string'
            ? projTitle
            : projTitle && typeof projTitle === 'object' && 'value' in projTitle
              ? (projTitle as { value?: unknown }).value
              : undefined
        const title = typeof resolvedTitle === 'string' ? resolvedTitle : (s.title as string)
        const agentPreset = typeof proj?.agentPreset === 'string' ? proj.agentPreset : undefined
        // 计划模式：goal 投影存在且未 complete（对应旧 projections.plan.active）
        const goal = proj?.goal as { goal?: { phase?: string } } | null | undefined
        const planActive = goal != null && goal.goal != null && goal.goal.phase !== 'complete'
        return {
          sessionId: String(s.sessionId ?? ''),
          title: title || '新会话',
          updatedAt: Number(s.updatedAt ?? 0),
          running: Boolean(s.running),
          blank: Boolean(s.blank),
          cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
          agentPreset,
          planActive,
        }
      })
  }

  createSession(cwd?: string, agentPreset?: string): Promise<{ sessionId: string }> {
    const payload: { workspaceId?: string; cwd?: string; agentPreset?: string } = {}
    if (cwd) payload.cwd = cwd
    if (agentPreset) payload.agentPreset = agentPreset
    return this.client.createSession(payload)
  }

  /**
   * 拉取归档会话历史：通过 session/follow 流，首帧 snapshot 即完整历史。
   * 归档只读视图用（官方 UI 的归档面板 overlay）。读完首帧即取消流——
   * 后续实时帧无人消费，留着会让每条不同会话的 follow 子流常驻 mux 连接。
   */
  async getHistory(sessionId: string): Promise<{ events: SessionStreamEvent[]; hasMore: boolean }> {
    const stream = this.client.followSession(sessionId)
    try {
      const first = (await stream.first()) as Record<string, unknown> | null | undefined
      if (first && first.type === 'snapshot') {
        return {
          events: normalizeHistory((first.records as unknown[] | undefined) ?? []),
          hasMore: Boolean((first as { hasMore?: boolean }).hasMore),
        }
      }
      return { events: [], hasMore: false }
    } finally {
      stream.onItem = null
      this.client.muxCancel(stream)
    }
  }

  async sendMessage(sessionId: string, text: string): Promise<{ accepted: boolean }> {
    const content: unknown[] = [{ type: 'text', text }]
    return this.client.prompt({
      sessionId,
      mode: 'queue',
      content,
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  }

  cancelTurn(sessionId: string): Promise<{ accepted: boolean }> {
    return this.client.cancel({ sessionId })
  }

  /**
   * 归档会话。
   *
   * `stopActivity: true` 让引擎先停掉会话的运行中工作（回合、子代理、后台任务、
   * 定时提醒）再落盘归档。0.1.7-alpha.1 起不带该标志的归档会被运行中的工作拒绝
   * （错误码 `workspace/session-active`），归档集合不变——需要"隐藏一个正在跑的
   * 会话"的调用方（硬删）必须显式传入。
   */
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<{ archivedSessionIds: string[] }> {
    return this.client.archiveSession({ sessionId, ...options })
  }

  /**
   * 取消归档：把 sessionId 从引擎的归档集合里摘掉。
   *
   * 上游 0.1.6-alpha.1 起提供。幂等；不校验会话是否存在，所以日志文件已删的
   * 会话也能清掉。注意引擎仍持有该会话（live）时调用会让它回到活跃列表——
   * 调用方需自行判断时机（见 electron/ipc.ts 的硬删收尾）。
   */
  unarchiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
    return this.client.unarchiveSession({ sessionId })
  }

  /**
   * 拉取已归档会话：打开 workspace/follow 流，读首帧 baseline 后取消。
   * baseline.archivedSessionIds 即归档集合；cwd 见 archivedCwds。
   */
  async listArchivedSessions(): Promise<ArchivedSessionInfo[]> {
    const stream = this.client.workspaceFollow()
    let baseline: Record<string, unknown> | null = null
    try {
      const first = (await stream.first()) as Record<string, unknown> | null | undefined
      if (first && first.type === 'baseline') baseline = (first.value as Record<string, unknown>) ?? null
    } finally {
      stream.onItem = null
      this.client.muxCancel(stream)
    }
    if (!baseline) return []
    const archivedIds = ((baseline.archivedSessionIds as unknown[] | undefined) ?? [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    // 会话摘要自带权威 cwd；拿不到（引擎瞬时不可用）就退回工作区成员表。
    let summaries: SessionSummary[] = []
    try {
      summaries = await this.listSessions()
    } catch {
      // 硬删照旧尽力而为
    }
    const cwdBySession = archivedCwds(baseline, summaries)
    return archivedIds.map((sessionId) => ({
      sessionId,
      cwd: cwdBySession.get(sessionId),
    }))
  }

  // ---- 模型 ----

  async listModels(): Promise<ModelGroup[]> {
    const { groups } = await this.client.modelCatalog()
    return (groups ?? []).map((g) => ({
      id: String(g.id ?? ''),
      name: String(g.name ?? g.id ?? ''),
      models: ((g.models as unknown[]) ?? []).map((m) => {
        const model = m as Record<string, unknown>
        return {
          id: String(model.id ?? ''),
          name: String(model.name ?? model.id ?? ''),
          description: typeof model.description === 'string' ? model.description : undefined,
        }
      }),
    }))
  }

  // ---- 凭据 ----

  async setApiKey(key: string): Promise<void> {
    await this.client.credentialsSet({ ref: 'DEEPSEEK_API_KEY', value: key })
  }

  pickDirectory(): Promise<{ path: string | null }> {
    return this.client.pickDirectory().then((path) => ({ path }))
  }

  close() {
    this.client.close()
  }
}

/**
 * 归档集合的 sessionId → cwd 映射，用于硬删定位日志目录。
 *
 * 两个来源，`session/list` 的摘要优先（后写覆盖）：
 *
 *  1. baseline.items[].sessionIds → workspace.path。这只是**工作区成员表**
 *     （引擎文档：`WorkspaceView.sessionIds` supplies real-Workspace membership,
 *     not Session display order），只覆盖「已登记进工作区」的会话。
 *  2. 会话摘要的 `cwd`——建会话时传入的原样字符串，与引擎
 *     `sessions/<projectKey(cwd)>/<sessionId>` 的落盘规则同源，故可直接用于定位。
 *
 * 只靠来源 1 会漏：桌面向导走 `session/create {cwd}`（不带 workspaceId），
 * 这类会话永远不是工作区成员，cwd 解析成 undefined，硬删于是去
 * `sessions/_no-cwd` 找日志目录，真实目录永不删除（静默留下磁盘残留）。
 * 归档会话仍出现在 `session/list` 里（引擎重启后亦然），故来源 2 覆盖完整。
 *
 * 纯函数，便于单测（不碰 transport）。
 *
 * @param baseline - workspace/follow 首帧 baseline（读 items[].path / sessionIds）
 * @param summaries - session/list 的会话摘要（读 sessionId / cwd）
 * @returns sessionId → cwd；两个来源都没有的会话不在 map 里
 */
export function archivedCwds(
  baseline: Record<string, unknown>,
  summaries: readonly SessionSummary[],
): Map<string, string> {
  const cwdBySession = new Map<string, string>()
  const items = (baseline.items as unknown[] | undefined) ?? []
  for (const w of items) {
    const ws = w as Record<string, unknown>
    const path = typeof ws.path === 'string' ? ws.path : undefined
    if (!path) continue
    for (const id of (ws.sessionIds as unknown[] | undefined) ?? []) {
      if (typeof id === 'string') cwdBySession.set(id, path)
    }
  }
  for (const s of summaries) {
    if (s.cwd) cwdBySession.set(s.sessionId, s.cwd)
  }
  return cwdBySession
}

export type { DshEvent, MessageBlock }
