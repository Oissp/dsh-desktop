/**
 * adapter/dsh-client.ts —— 低层传输客户端（alpha.2 Typert Remote 协议）。
 *
 * dsh v0.1.2-alpha.2 移除了旧的 host-apiproxy（dotted method JSON-RPC + events.mux），
 * 改为 Typert Remote 网关：
 *  - 一元 RPC：POST /api/<namespace>/<method>，body {type:'client-request', rpcId, method, payload:{args}}
 *    响应 {type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}
 *  - 强制浏览器认证：启动 URL 携带 ?token=，GET /?token= → 303 + Set-Cookie，
 *    所有 /api/* 请求都必须带该 Cookie。
 *
 * 本文件只负责传输与信封，不包含业务语义。
 */
import { randomUUID } from 'node:crypto'
import { fetchWithTimeout } from '../shared/fetch-timeout.js'

export interface RpcRequest {
  type: 'client-request'
  rpcId: string
  method: string
  payload: { args: Record<string, unknown> }
}

export interface RpcResponse<T = unknown> {
  type: 'server-response'
  rpcId: string
  result: RpcResult<T>
}

export interface RpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

export class DshTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DshTransportError'
  }
}

let rpcCounter = 0
export function nextRpcId(): string {
  rpcCounter += 1
  return `hd-${Date.now().toString(36)}-${rpcCounter}`
}

/**
 * 低层传输客户端：unary RPC 的 HTTP POST。
 * 不包含业务语义。
 */
export class DshClient {
  private baseUrl: string
  private authCookie: string | null = null
  /** 引擎版本（dsh package.json），由宿主注入（adapter 无法自行定位打包路径）。 */
  private engineVersion: string | null = null

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`
  }

  get port(): number {
    return Number(new URL(this.baseUrl).port)
  }

  /** 是否已完成浏览器认证（拿到会话 Cookie）。 */
  get authenticated(): boolean {
    return this.authCookie !== null
  }

  /** 注入引擎版本（供 describe 使用）。 */
  setVersion(version: string | null) {
    this.engineVersion = version
  }

  /**
   * 用进程启动令牌换取会话 Cookie：GET /?token=X → 303 + Set-Cookie（不跟随重定向）。
   * 成功返回 cookie 的 "name=value" 段；失败返回 null（引擎尚未就绪/令牌无效）。
   */
  async exchangeToken(token: string): Promise<boolean> {
    try {
      // establishAuth 在外层以 READY_TIMEOUT_MS（90s）为总预算重试本方法；若单次超时设得
      // 太短（曾用 10s），引擎认证接口只是偏慢而非假死时，会在总预算耗尽前被"超时→重试"
      // 自我消耗掉，而非真正等到认证成功。与 request() 的 30s 对齐，给慢但存活的场景留够空间。
      const res = await fetchWithTimeout(`${this.baseUrl}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' }, 30_000)
      if (res.status !== 303) return false
      const setCookie = res.headers.get('set-cookie') ?? res.headers.get('Set-Cookie') ?? ''
      const m = /^([^;=]+)=([^;]*)/.exec(setCookie.trim())
      if (!m) return false
      this.authCookie = `${m[1]}=${m[2]}`
      return true
    } catch {
      return false
    }
  }

  private async request<T>(method: string, args: Record<string, unknown>): Promise<T> {
    if (!this.authCookie) {
      throw new DshTransportError('未完成引擎认证（缺少会话 Cookie）')
    }
    const rpcId = nextRpcId()
    const body: RpcRequest = { type: 'client-request', rpcId, method, payload: { args } }
    let res: Response
    try {
      // 加超时：引擎假死时裸 fetch 会永久挂起，连带 IPC/UI 无响应
      res = await fetchWithTimeout(
        `${this.baseUrl}/api/${method}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: this.authCookie },
          body: JSON.stringify(body),
        },
        30_000,
      )
    } catch (err) {
      throw new DshTransportError(`dsh 通信失败（${method}）: ${(err as Error).message}`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new DshTransportError(`dsh HTTP ${res.status} for ${method}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as RpcResponse<T>
    if (data.type !== 'server-response') {
      throw new DshTransportError(`dsh 返回了意外的消息类型: ${data.type}`)
    }
    if (!data.result.ok) {
      const err = data.result.error ?? { code: 'unknown', message: '未知错误' }
      const e = new Error(err.message) as Error & { code?: string }
      ;(e as { code?: string }).code = err.code
      throw e
    }
    return data.result.value as T
  }

  /** 就绪探测：发起一次无需业务状态的认证请求。 */
  async probeReady(): Promise<boolean> {
    if (!this.authCookie) return false
    try {
      await this.request('session/modelCatalog', {})
      return true
    } catch {
      return false
    }
  }

  // ---- 业务方法（薄封装：参数按 descriptor 的 wire 名包进 args） ----

  describeHost(): Promise<{
    version: string | null
    cwd: string | null
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }> {
    return this.summarize()
  }

  private async summarize(): Promise<{
    version: string | null
    cwd: string | null
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }> {
    let provider: string | undefined
    let model: string | undefined
    let attachedSessions = 0
    let canOpenPath = false
    try {
      const catalog = await this.request<{ default?: { provider?: string; model?: string } }>('session/modelCatalog', {})
      provider = catalog.default?.provider
      model = catalog.default?.model
    } catch {
      // 目录不可用不影响描述
    }
    try {
      const list = await this.request<{ items?: unknown[] }>('session/list', { _request: {} })
      attachedSessions = Array.isArray(list.items) ? list.items.length : 0
    } catch {
      // 列表不可用不影响描述
    }
    try {
      canOpenPath = Boolean(await this.request<boolean>('session/canOpenWorkspacePath', {}))
    } catch {
      // 忽略
    }
    return { version: this.engineVersion, cwd: null, provider, model, attachedSessions, canOpenPath }
  }

  listSessions(): Promise<{ items: unknown[] }> {
    return this.request('session/list', { _request: {} })
  }

  createSession(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.request('session/create', { request: payload })
  }

  prompt(payload: { sessionId: string; mode: 'queue' | 'steer'; content: unknown[]; clientTimeZone?: string }): Promise<{ accepted: boolean }> {
    return this.request('session/prompt', {
      request: { requestId: randomUUID(), ...payload },
    })
  }

  cancel(payload: { sessionId: string }): Promise<{ accepted: boolean }> {
    return this.request('session/cancel', { request: payload })
  }

  modelCatalog(): Promise<{
    default: { provider: string; model: string; reasoningEffort?: string }
    routableProviders: string[]
    groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string; reasoning?: unknown }> }>
    failures: unknown[]
  }> {
    return this.request('session/modelCatalog', {})
  }

  credentialsSet(payload: { ref: string; value: string }): Promise<void> {
    return this.request('credentials/set', payload)
  }

  pickDirectory(): Promise<string | null> {
    return this.request('directoryPicker/pick', {})
  }
}
