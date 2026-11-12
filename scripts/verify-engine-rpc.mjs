// 真引擎 RPC 验证套件：对升级后的 dsh 引擎做端到端冒烟。
//
// 前置：先启动真实桌面应用（不要裸 spawn `dsh web`，脱离 Electron 时 /api 路由挂不出来）：
//   npx electron . --remote-debugging-port=9222
// 等主窗口切到官方 Web UI 后运行：
//   node scripts/verify-engine-rpc.mjs [cdp端口，默认 9222]
//
// 流程：经 CDP `Network.getCookies` 取引擎会话 Cookie（仅驻内存），对
// `/api/<namespace>/<method>` 跑 modelCatalog / list / create / prompt+cancel /
// 持久化复查。wire 格式（详见 dsh-client-connection 与 dsh-api-gateway 源码）：
// - body 是信封 {"type":"client-request","rpcId":...,"method":"<endpoint>","payload":{"args":{...}}}；
//   payload 必须恰好含一个 plain-object 的 `args` 字段。
// - RPC 错误同样返回 HTTP 200（result.ok=false），必须检查 body 而非状态码。

const CDP_PORT = Number(process.argv[2]) || 9222

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(t.url))
if (!page) {
  console.error(`未找到引擎 UI 页面目标（CDP ${CDP_PORT}）。请先启动应用：npx electron . --remote-debugging-port=${CDP_PORT}`)
  process.exit(2)
}
const ENGINE = new URL(page.url).origin

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let msgId = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function cdp(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const cookies = (await cdp('Network.getCookies', { urls: [ENGINE] })).result.cookies
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
ws.close()

const api = (endpoint, payload) =>
  fetch(`${ENGINE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `verify-${Math.random().toString(36).slice(2)}`,
      method: endpoint,
      payload,
    }),
  }).then(async (res) => ({ status: res.status, body: await res.text() }))

const results = []
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail?.slice(0, 200) })
}

// 1. session/modelCatalog
{
  const res = await api('session/modelCatalog', { args: {} })
  check('session/modelCatalog 200', res.status === 200, `${res.status} ${res.body}`)
  try {
    const parsed = JSON.parse(res.body)
    const value = parsed?.result?.value
    check('modelCatalog 有条目', !!value && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0), res.body)
  } catch { check('modelCatalog 可解析', false, res.body) }
}

// 2. session/list（参数名 `_request` 为保留的空请求）
{
  const res = await api('session/list', { args: { _request: {} } })
  check('session/list 200', res.status === 200, `${res.status} ${res.body}`)
}

// 3. session/create + prompt + cancel + 持久化复查
let sessionId = null
{
  const res = await api('session/create', { args: { request: {} } })
  check('session/create 200', res.status === 200, `${res.status} ${res.body}`)
  try {
    const parsed = JSON.parse(res.body)
    if (parsed?.result?.ok === false) {
      check('session/create ok', false, res.body)
    } else {
      sessionId = parsed?.result?.value?.sessionId ?? null
      check('session/create 返回 id', !!sessionId, res.body)
    }
  } catch { check('session/create 可解析', false, res.body) }
}

if (sessionId) {
  const promptRes = await api('session/prompt', { args: { request: {
    requestId: `verify-${Date.now()}`,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: '回复"ok"两个字母即可，不要使用工具。' }],
  } } })
  check('prompt 已受理(accepted)', promptRes.status === 200 && promptRes.body.includes('"accepted":true'), `${promptRes.status} ${promptRes.body}`)
  const cancelRes = await api('session/cancel', { args: { request: { sessionId } } })
  check('cancel 已受理(accepted)', cancelRes.status === 200 && cancelRes.body.includes('"accepted":true'), `${cancelRes.status} ${cancelRes.body}`)
  // 持久化复查：session/list 应能列出刚创建的会话
  const listRes = await api('session/list', { args: { _request: {} } })
  check('持久化复查含新会话', listRes.body.includes(sessionId), sessionId)
}

const failed = results.filter((x) => !x.pass)
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.pass ? '' : ` — ${x.detail}`}`)
console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
