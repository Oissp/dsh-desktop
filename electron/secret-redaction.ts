/**
 * electron/secret-redaction.ts —— 从自由文本里抹掉疑似凭据。
 *
 * 为什么需要这一层：引擎的 stderr 会流向两处**持久**输出——恢复页 UI（`status.error`）
 * 和 `userData/logs/` 落盘文件（以及崩溃报告）。引擎自己有脱敏
 * （`@deepseek-ai/dsh-settings` 的 `redactSecrets`），但那是**结构化**的：只对
 * settings schema 里声明了 `role('secret')` 的字段生效。对自由文本无效——而凭据恰恰
 * 容易从自由文本里漏出来：失败的 HTTP 请求会带上 URL 里的 `?token=`、Stack 里会夹
 * `Authorization` 头、`ECONNREFUSED` 的上下文对象常带着整个配置。
 *
 * 这一层是**兜底，不是保证**。它只认已知形态（各家 token 前缀、header、key=value、
 * URL 查询参数、JWT、PEM）。没有已知前缀、又不在键值对里的裸密钥认不出来——
 * 想靠"高熵就抹"覆盖它，代价是把 session id、构建哈希、diff 片段一起抹掉，
 * 报告会变得没法看。宁可少抹也不能把诊断价值抹没，所以那条路没走。
 *
 * 另一处已知边界：引号值被从中间截断（`password="ab` + 换行）时只抹到第一个空白。
 * 现实里截断发生在 stderr 的分块边界上，凭据值本身不含空格，整段仍会被抹掉；
 * 这里选择收手而不是让正则一路扫到文末——那正是把崩溃路径拖死的那类写法。
 */

/** 替换标记。保留"这里原本有个凭据"这个事实，本身不含任何原文。 */
export const REDACTED = '[已隐去]'

/**
 * 各家 token 前缀。前缀部分**公开**（`sk-` 不是秘密，`sk-` 后面的才是），
 * 所以保留前缀能告诉人"这是哪个供应商的 key 失效了"，而不泄露 key 本身。
 */
const TOKEN_PREFIXES = [
  'sk-ant-',
  'sk-proj-',
  'sk-or-',
  'sk-',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'github_pat_',
  'xoxb-',
  'xoxp-',
  'xoxa-',
  'glpat-',
  'npm_',
  'pypi-',
  'hf_',
  'dsk-',
]

/**
 * 出现在键名里就说明"这个值是敏感的"的词。
 *
 * 两侧的 `\b`（见 KEY_NAME）是这一层的关键：没有它们，`max_output_tokens=4096`
 * 会因为含 `token` 被抹成 `max_output_tokens=[已隐去]`——LLM 配置里满是 token 计数，
 * 这类误抹既丢诊断价值又制造恐慌。加了词边界后只有 `token`、`access_token`、
 * `my_api_key` 这种敏感词真正**成段**的键名才算数，`max_tokens`、`tokens_per_minute` 不算。
 */
const SECRET_KEY_WORDS =
  'api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|bearer[_-]?token|id[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|session[_-]?(?:cookie|token)|secret|password|passwd|passphrase|credential|authorization|token'

/**
 * 键名整体：允许前后缀（`OPENAI_API_KEY`、`my_api_key_old`），敏感词要独立成段。
 *
 * 前后缀的量词**必须有上界**。写成 `[A-Za-z0-9_.-]*` 时，在一条 50 万字符、
 * 不含任何 `=` 的长文本上，正则会在每个起始位置把整段吃进去再逐字符回溯找敏感词，
 * 复杂度 O(n²)——而这层脱敏正好跑在崩溃路径上（错误段的输入上限是 256 KiB），
 * 会把主进程钉死在那儿。键名不可能有 32 个字符以上，加上界既正确又把每次尝试
 * 压成常数时间。
 */
const KEY_NAME = `[A-Za-z0-9_.-]{0,32}\\b(?:${SECRET_KEY_WORDS})\\b[A-Za-z0-9_.-]{0,32}`

interface Rule {
  /** 规则名，测试与排错用。 */
  readonly name: string
  readonly re: RegExp
  readonly to: string
}

/**
 * 规则按此顺序应用，顺序是**功能性的**，不能随手调整：
 *
 * 1. PEM 块最先：否则内部的 base64 会被后面的规则零碎命中，留下半截。
 * 2. header 三兄弟在键值规则**之前**：`Authorization: Bearer sk-xxx` 若先走键值规则，
 *    只会吃到 `Bearer`（值里带空格），把 `sk-xxx` 留给前缀规则，产出
 *    `Authorization: [已隐去] sk-[已隐去]` —— 啰嗦且暴露键名之外的结构。
 * 3. 键值规则在**前缀规则之前**：反过来的话，`token: ghp_xxx` 会先被前缀规则变成
 *    `token: ghp_[已隐去]`，随后键值规则的值类又吃掉 `ghp_` 这一截，产出
 *    `token: [已隐去][已隐去]` —— 双标记。见测试「规则顺序不会产出重复标记」。
 * 4. 查询参数最后兜底（`?key=`、`?code=` 这类键名本身不在敏感词表里的）。
 */
const RULES: readonly Rule[] = [
  {
    name: 'pem-private-key',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    to: `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`,
  },
  {
    name: 'auth-header',
    re: /^([ \t]*(?:proxy-)?authorization[ \t]*[:=][ \t]*).*$/gim,
    to: `$1${REDACTED}`,
  },
  {
    name: 'cookie-header',
    re: /^([ \t]*(?:set-)?cookie[ \t]*:[ \t]*).*$/gim,
    to: `$1${REDACTED}`,
  },
  {
    name: 'bearer-scheme',
    re: /\b(bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}/gi,
    to: `$1${REDACTED}`,
  },
  {
    // 带引号的值：`password="my secret"` 含空格，无引号规则只会吃到 `my`，
    // 留下半截明文——所以先把整段引号值（含转义）一次吃掉。
    // 键名本身也可能带引号（JSON：`{"apiKey":"..."}`），故键名两侧加可选引号对。
    // 值的量词同样设上界：未闭合的引号（截断的日志）会让 `*` 一路扫到文末。
    name: 'secret-assignment-quoted',
    re: new RegExp(`(["']?)(${KEY_NAME})\\1([ \\t]*[:=][ \\t]*)(["'])(?:[^"'\\\\\\n]|\\\\.){0,1024}\\4`, 'gi'),
    to: `$1$2$1$3$4${REDACTED}$4`,
  },
  {
    // 无引号的值：吃到空白或常见分隔符为止；前导引号保留（看得出原本是字符串字面量）。
    // 值类里排掉 `[` 是为了**幂等**：标记本身以 `[` 开头，否则第二次施加会把它
    // 再吃一遍，产出 `[已隐去]]` 这种带尾括号的怪东西。
    name: 'secret-assignment',
    re: new RegExp(`(["']?)(${KEY_NAME})\\1([ \\t]*[:=][ \\t]*)(["']?)[^\\s"'&,;}\\[\\]]+`, 'gi'),
    to: `$1$2$1$3$4${REDACTED}`,
  },
  {
    name: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    to: REDACTED,
  },
  {
    name: 'aws-access-key-id',
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    to: REDACTED,
  },
  {
    name: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    to: REDACTED,
  },
  {
    // 长前缀要排在短前缀前面，否则 sk-ant-xxx 会被 sk- 先吃掉、只剩 "ant-xxx" 被抹
    name: 'known-token-prefix',
    re: new RegExp(`\\b(${[...TOKEN_PREFIXES].sort((a, b) => b.length - a.length).join('|')})[A-Za-z0-9_./+-]{8,}`, 'g'),
    to: `$1${REDACTED}`,
  },
  {
    name: 'secret-query-param',
    re: /([?&](?:token|key|api[_-]?key|apikey|access[_-]?token|auth|password|secret|code)=)[^&\s"'#]+/gi,
    to: `$1${REDACTED}`,
  },
]

/**
 * 抹掉文本里已知形态的凭据。纯函数、幂等（标记本身不含会被再次命中的内容）。
 */
export function redactSecrets(text: string): string {
  let out = text
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    out = out.replace(rule.re, rule.to)
  }
  return out
}
