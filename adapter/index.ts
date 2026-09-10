/**
 * adapter/index.ts —— 高层的稳定 API。
 *
 * 主进程通过这个类访问 dsh 的全部能力。dsh 上游变更只会影响
 * DshClient（dsh-client.ts）与 normalize*（events.ts），本文件尽量薄。
 */
import { DshClient, type RemoteStream } from './dsh-client.js'
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
  /** 已打开的 session/follow 流（sessionId → stream），为归档只读视图提供历史。 */
  private follows = new Map<string, RemoteStream>()

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
   * 归档只读视图用（官方 UI 的归档面板 overlay）。
   */
  async getHistory(sessionId: string): Promise<{ events: SessionStreamEvent[]; hasMore: boolean }> {
    const prev = this.follows.get(sessionId)
    if (prev) {
      prev.onItem = null
      this.client.muxCancel(prev)
      this.follows.delete(sessionId)
    }
    const stream = this.client.followSession(sessionId)
    this.follows.set(sessionId, stream)
    const first = (await stream.first()) as Record<string, unknown> | null | undefined
    // 归档只读视图只消费 snapshot；后续实时帧丢弃（防止无人消费时无限积压）
    stream.onItem = () => {}
    if (first && first.type === 'snapshot') {
      return {
        events: normalizeHistory((first.records as unknown[] | undefined) ?? []),
        hasMore: Boolean((first as { hasMore?: boolean }).hasMore),
      }
    }
    return { events: [], hasMore: false }
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

  archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
    return this.client.archiveSession({ sessionId })
  }

  /**
   * 拉取已归档会话：打开 workspace/follow 流，读首帧 baseline 后取消。
   * baseline.archivedSessionIds 即归档集合；各 workspace.sessionIds → path 映射给出 cwd（用于删除定位）。
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
    const archivedIds = (baseline.archivedSessionIds as unknown[] | undefined) ?? []
    // 构建 sessionId → workspace.path 映射（归档会话仍保留在其 workspace 的 sessionIds 中）
    const cwdBySession = new Map<string, string>()
    const items = (baseline.items as unknown[] | undefined) ?? []
    for (const w of items) {
      const ws = w as Record<string, unknown>
      const path = typeof ws.path === 'string' ? ws.path : undefined
      const ids = (ws.sessionIds as unknown[] | undefined) ?? []
      if (!path) continue
      for (const id of ids) {
        if (typeof id === 'string') cwdBySession.set(id, path)
      }
    }
    return archivedIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((sessionId) => ({
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
    for (const stream of this.follows.values()) {
      stream.onItem = null
      this.client.muxCancel(stream)
    }
    this.follows.clear()
    this.client.close()
  }
}

export type { DshEvent, MessageBlock }
