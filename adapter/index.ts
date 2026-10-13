/**
 * adapter/index.ts —— 高层的稳定 API。
 *
 * 主进程通过这个类访问 dsh 的全部能力。dsh 上游变更只会影响
 * DshClient（dsh-client.ts），本文件尽量薄。
 */
import { DshClient } from './dsh-client.js'
import type { ModelGroup, SessionSummary } from '../shared/types.js'

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
}
