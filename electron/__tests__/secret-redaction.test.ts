/**
 * electron/__tests__/secret-redaction.test.ts —— 凭据脱敏。
 *
 * 这个模块的错误方向**两个都贵**，所以两个方向都要钉：
 *  · 漏抹（false negative）= 用户的 API key 进了公开 issue；
 *  · 误抹（false positive）= 报告被抹成一堆 [已隐去]，没人能从里面查出问题。
 * 后半类测试（"不该动的别动"）和前一类同样重要——`max_tokens=4096` 被抹掉
 * 远比它看起来严重：那是排查模型配置问题的关键线索。
 */
import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets } from '../secret-redaction.js'

describe('redactSecrets — 已知 token 前缀', () => {
  it('抹掉 sk- 系密钥，保留前缀（看得出是哪家的 key 失效）', () => {
    expect(redactSecrets('认证失败 key=sk-abcdef1234567890abcdef')).toBe(`认证失败 key=sk-${REDACTED}`)
    expect(redactSecrets('key sk-ant-api03-AbCdEf1234567890')).toBe(`key sk-ant-${REDACTED}`)
    expect(redactSecrets('key sk-proj-AbCdEf1234567890')).toBe(`key sk-proj-${REDACTED}`)
  })

  it('抹掉 GitHub / Slack / GitLab / npm / HuggingFace 系 token，保留前缀', () => {
    // 夹具一律写成明显合成的形状（`notareal...`）：这里放形似真 token 的串会撞上
    // GitHub 的 push protection——实测 `xoxb-<12位数字>-<16位字母>` 被判定为 Slack
    // token 并直接拒绝推送。脱敏规则只认"前缀 + 后续不短于 8 位"，合成串同样覆盖。
    const cases: [prefix: string, key: string][] = [
      ['ghp_', 'ghp_notarealgithubtoken000000000000'],
      ['github_pat_', 'github_pat_notarealgithubtoken000000000000'],
      ['xoxb-', 'xoxb-notarealslacktoken'],
      ['xoxp-', 'xoxp-notarealslacktoken'],
      ['glpat-', 'glpat-notarealgitlabtoken'],
      ['npm_', 'npm_notarealnpmtoken000000000000'],
      ['hf_', 'hf_notarealhuggingfacetoken0000'],
    ]
    for (const [prefix, key] of cases) {
      // 中性载体（不含 `=`/`:`）：只有前缀规则命中，因此能观察到"前缀保留"这个意图
      expect(redactSecrets(`认证失败，凭据 ${key} 被拒绝`), key).toBe(`认证失败，凭据 ${prefix}${REDACTED} 被拒绝`)
    }
  })

  it('token 作为敏感键的值出现时连前缀一起抹掉（键名已说明是什么，不需要留前缀）', () => {
    expect(redactSecrets('token: ghp_notarealgithubtoken000000000000')).toBe(`token: ${REDACTED}`)
    expect(redactSecrets('apiKey="xoxb-notarealslacktoken"')).toBe(`apiKey="${REDACTED}"`)
  })

  it('抹掉 AWS access key id 与 Google API key（无公开前缀可保留）', () => {
    // 下面三个是**合成**值（AWS 文档的占位形状 + 顺序数字/字母），不是真凭据，
    // 无需轮换。但它们与真实 key 的形状一致——本模块的规则要求的正是
    // `(AKIA|ASIA)[0-9A-Z]{16}` 与 `AIza[0-9A-Za-z_-]{35}`，而 GitHub secret
    // scanning 的检测器匹配的也是同一个格式，所以**没有**既能满足规则、又不像
    // 真 key 的写法（Slack 那条夹具能写成 notareal… 是因为我们的规则比 GitHub 的
    // 检测器宽松，这里两边一样严）。这两个形状会被报成
    // "Amazon AWS Temporary Access Key ID" 与 "Google API Key"，已在仓库的
    // secret scanning 里按 used_in_tests 结案——改这几个字面量请顺手看一眼
    // https://github.com/Oissp/dsh-desktop/security/secret-scanning
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE 被拒')).toBe(`${REDACTED} 被拒`)
    expect(redactSecrets('ASIAIOSFODNN7EXAMPLE 被拒')).toBe(`${REDACTED} 被拒`)
    expect(redactSecrets('AIzaSyD-1234567890abcdefghijklmnopqrstu 无效')).toBe(`${REDACTED} 无效`)
  })

  it('过短的前缀串不算（sk-1 不是密钥，不能误伤）', () => {
    expect(redactSecrets('版本 sk-1 已弃用')).toBe('版本 sk-1 已弃用')
  })
})

describe('redactSecrets — header 与 scheme', () => {
  it('抹掉 Authorization / Proxy-Authorization 整行值', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toBe(`Authorization: ${REDACTED}`)
    expect(redactSecrets('  proxy-authorization = Basic dXNlcjpwYXNz')).toBe(`  proxy-authorization = ${REDACTED}`)
  })

  it('抹掉 Cookie / Set-Cookie 整行值', () => {
    expect(redactSecrets('Cookie: dsh_session=abc123; theme=dark')).toBe(`Cookie: ${REDACTED}`)
    expect(redactSecrets('Set-Cookie: dsh_session=abc123; HttpOnly; Path=/')).toBe(`Set-Cookie: ${REDACTED}`)
  })

  it('header 规则能处理多行文本中间的一行', () => {
    const text = ['GET /api/workspace/session.list', 'Authorization: Bearer sk-live-abc', 'accept: application/json'].join('\n')
    const out = redactSecrets(text)
    expect(out).toContain(`Authorization: ${REDACTED}`)
    // 相邻的非敏感 header 一动不动
    expect(out).toContain('accept: application/json')
    expect(out).toContain('GET /api/workspace/session.list')
  })

  it('裸 Bearer 也抹（不只 header 行里）', () => {
    expect(redactSecrets('用 Bearer abcdefghijklmnop 重试')).toBe(`用 Bearer ${REDACTED} 重试`)
  })
})

describe('redactSecrets — 键值对', () => {
  it('抹掉敏感键名的值，保留键名与引号形态', () => {
    expect(redactSecrets('apiKey=hunter2hunter2')).toBe(`apiKey=${REDACTED}`)
    expect(redactSecrets('apiKey: hunter2hunter2')).toBe(`apiKey: ${REDACTED}`)
    expect(redactSecrets('OPENAI_API_KEY=sk-abcdef1234567890')).toBe(`OPENAI_API_KEY=sk-${REDACTED}`)
    expect(redactSecrets('client_secret: "s3cr3t-value"')).toBe(`client_secret: "${REDACTED}"`)
    expect(redactSecrets('password=pa55w0rd')).toBe(`password=${REDACTED}`)
    expect(redactSecrets('saved api_key=abc123def456 in profile')).toBe(`saved api_key=${REDACTED} in profile`)
  })

  it('带引号的值含空格时整段抹掉，不留半截明文', () => {
    expect(redactSecrets('password="my secret phrase"')).toBe(`password="${REDACTED}"`)
    expect(redactSecrets("password='a b c d'")).toBe(`password='${REDACTED}'`)
    expect(redactSecrets('client_secret="escaped \\" quote inside"')).toBe(`client_secret="${REDACTED}"`)
  })

  it('JSON 片段里的敏感字段也抹掉', () => {
    const out = redactSecrets('{"provider":"deepseek","apiKey":"abcdef123456","model":"deepseek-chat"}')
    expect(out).toContain(`"apiKey":"${REDACTED}"`)
    // 非敏感字段完整保留（排查模型配置全靠它们）
    expect(out).toContain('"provider":"deepseek"')
    expect(out).toContain('"model":"deepseek-chat"')
  })

  it('URL 查询参数里的 token / key 抹掉，其它参数保留', () => {
    expect(redactSecrets('GET http://127.0.0.1:51923/?token=abc123def')).toBe(
      `GET http://127.0.0.1:51923/?token=${REDACTED}`,
    )
    expect(redactSecrets('https://api.example.com/v1?key=abc123&stream=true')).toBe(
      `https://api.example.com/v1?key=${REDACTED}&stream=true`,
    )
    expect(redactSecrets('https://x/cb?code=oauthcode123&state=s')).toBe(
      `https://x/cb?code=${REDACTED}&state=s`,
    )
  })
})

describe('redactSecrets — 结构化凭据', () => {
  it('抹掉 JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const out = redactSecrets(`校验失败: ${jwt}`)
    expect(out).toBe(`校验失败: ${REDACTED}`)
  })

  it('抹掉 PEM 私钥块（多行，整块替换而不是零碎命中内部 base64）', () => {
    const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA1234', 'abcd5678efgh', '-----END RSA PRIVATE KEY-----'].join('\n')
    const out = redactSecrets(`签名失败:\n${pem}\n重试中`)
    expect(out).not.toContain('MIIEowIBAAKCAQEA1234')
    expect(out).not.toContain('abcd5678efgh')
    expect(out).toContain('重试中')
    expect(out).toContain(REDACTED)
  })
})

describe('redactSecrets — 不该动的一个字都不能动', () => {
  it('token 计数的键名不误伤（LLM 配置里最容易被冤枉的一类）', () => {
    for (const text of [
      'max_tokens=4096',
      'max_output_tokens: 8192',
      'tokens_per_minute=100000',
      'tokenizer=cl100k_base',
      'context_window_tokens=64000',
    ]) {
      expect(redactSecrets(text), text).toBe(text)
    }
  })

  it('普通配置项不误伤', () => {
    for (const text of [
      'model=deepseek-chat',
      'provider: deepseek',
      'timeout=30000',
      'sessionId=01JABCDEF',
      'temperature=0.7',
      'baseUrl=https://api.deepseek.com',
      'cwd=/home/u/projects/demo',
    ]) {
      expect(redactSecrets(text), text).toBe(text)
    }
  })

  it('堆栈与错误消息一字不改（诊断价值全靠它）', () => {
    const stack = [
      'Error: connect ECONNREFUSED 127.0.0.1:51923',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)',
      '    at DshManager.waitUntilReady (electron/dsh-manager.ts:170:12)',
      '    at async Object.start (electron/main.ts:318:5)',
    ].join('\n')
    expect(redactSecrets(stack)).toBe(stack)
  })

  it('中文错误消息一字不改', () => {
    const msg = '配置快照失败：磁盘空间不足（ENOSPC），已降级为无快照继续启动'
    expect(redactSecrets(msg)).toBe(msg)
  })

  it('git 短哈希与路径里的 key 字样不误伤', () => {
    expect(redactSecrets('commit 58898c3 修复硬删 cwd 解析')).toBe('commit 58898c3 修复硬删 cwd 解析')
    expect(redactSecrets('读取 /home/u/.config/dsh/keyring.json')).toBe('读取 /home/u/.config/dsh/keyring.json')
    expect(redactSecrets('已写入 profiles/web/cordis.patch.yml')).toBe('已写入 profiles/web/cordis.patch.yml')
  })

  it('空串与纯空白安全通过', () => {
    expect(redactSecrets('')).toBe('')
    expect(redactSecrets('   \n\t ')).toBe('   \n\t ')
  })
})

describe('redactSecrets — 性能（这层跑在崩溃路径上，卡住等于主进程卡死）', () => {
  it('256 KiB 无敏感词的文本不会退化成二次回溯', () => {
    // 长串里既没有 `=` 也没有 `:`：若 KEY_NAME 的前后缀量词无上界，正则会尝试在每个
    // 起始位置吃下整段再逐字符回溯（O(n²)），这里会直接超时
    const text = `${'x'.repeat(256 * 1024)}\n${'配置加载中 '.repeat(2_000)}`
    const started = Date.now()
    expect(redactSecrets(text)).toBe(text)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('截断在引号值中间时立即收手，不会一路扫到文末', () => {
    const text = `password="unterminated value without closing quote\n${'z'.repeat(128 * 1024)}`
    const started = Date.now()
    const out = redactSecrets(text)
    expect(Date.now() - started).toBeLessThan(2_000)
    // 已知边界（不是 bug，是有意收手）：未闭合的引号值只抹到第一个空白，
    // 后面的 `value without...` 会留下。现实中截断发生在 chunk 边界，凭据值
    // 不含空格，整段会被抹掉；这条只钉住"不会因为找不到收尾引号就卡住"。
    expect(out).toContain(`password="${REDACTED}`)
    expect(out).not.toContain('unterminated')
  })

  it('长文本中间的凭据照样抹掉（上界没有砍掉检测能力）', () => {
    const text = `${'x'.repeat(100_000)}\napiKey=abcdef123456\n${'y'.repeat(100_000)}`
    const out = redactSecrets(text)
    expect(out).toContain(`apiKey=${REDACTED}`)
    expect(out).not.toContain('abcdef123456')
  })
})

describe('redactSecrets — 幂等与规则顺序', () => {
  it('规则顺序不会产出重复标记（前缀规则的输出不被键值规则二次吞掉）', () => {
    // RULES 的顺序是功能性的：键值规则必须早于前缀规则，否则 `token: ghp_xxx` 会先被
    // 前缀规则变成 `token: ghp_[已隐去]`，键值规则再吃掉 `ghp_` 那一截 → 双标记。
    // 这条把顺序约束钉住，免得有人"整理"规则时把顺序改回去。
    for (const text of [
      'token: ghp_notarealgithubtoken000000000000',
      'apiKey=sk-abcdef1234567890',
      'apiKey="xoxb-notarealslacktoken"',
      '{"provider":"deepseek","apiKey":"sk-abcdef1234567890"}',
      'Authorization: Bearer sk-abcdef1234567890',
      'https://api.x/v1?token=sk-abcdef1234567890&stream=1',
    ]) {
      const out = redactSecrets(text)
      expect(out, text).not.toContain(`${REDACTED}${REDACTED}`)
      expect(out, text).not.toContain(`${REDACTED}]`)
      expect(out, text).not.toContain(`[${REDACTED}`)
    }
  })

  it('重复施加不改变结果（调用方可能已先抹过一遍）', () => {
    const text = 'Authorization: Bearer abc\napiKey=xyz123\n?token=q\nsk-abcdef1234567890'
    const once = redactSecrets(text)
    expect(redactSecrets(once)).toBe(once)
    expect(redactSecrets(redactSecrets(once))).toBe(once)
  })
})
