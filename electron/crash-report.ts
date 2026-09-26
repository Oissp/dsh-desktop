/**
 * electron/crash-report.ts —— 崩溃现场落盘（可读的单文件报告）。
 *
 * 借鉴上游 apps/desktop 的 crash-report.ts。普通日志是**流式**的：主进程崩溃时
 * 最后几行往往还没 flush，而 90 秒启动超时这类故障的现场又横跨上千行无关输出。
 * 崩溃报告解决的是另一个问题——把"这一刻的全部事实"（版本矩阵、错误及其 cause 链、
 * 引擎状态、渲染进程控制台尾部）压进**一个文件**，用户能直接把它贴进 issue。
 *
 * 三条设计约束：
 *  1. 渲染是纯函数（renderCrashReport），可测；落盘带 1s 时限，磁盘卡死时不能
 *     把致命退出路径一起拖死。
 *  2. 每一段都有字节上限——错误对象可能挂着巨大的 cause 链或 Buffer。
 *  3. 清理只认自己的文件名模式，绝不碰用户日志目录里的其它文件。
 *  4. 报告会被用户直接贴到公开 issue 里，所以**所有正文段落出渲染前都过一遍
 *     脱敏**（secret-redaction.ts）：异常消息里夹带的 URL token、请求头凭据
 *     不能因为"写进了崩溃报告"就泄露出去。
 */
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { redactSecrets } from './secret-redaction.js'

/** 崩溃来源：主进程 / 渲染进程 / 引擎子进程。 */
export type CrashSource = 'main' | 'renderer' | 'engine'

/**
 * 报告文件名模式：crash-<UTC 时间戳>-<来源>.log。
 * 时间戳里 `:` 与 `.` 都换成 `-`（FAT/Windows 不允许 `:`；换成 `-` 也避免与
 * `.log` 扩展名的分隔点混淆），字段定宽，因此**字典序 = 时间序**——
 * pruneCrashReports 依赖这一点排序。
 */
export const CRASH_REPORT_NAME = /^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:main|renderer|engine)\.log$/

/** 保留的报告份数：超出即删最旧的。 */
export const CRASH_REPORTS_RETAINED = 10

/** 单份报告中错误段的字节上限。 */
const MAX_ERROR_BYTES = 256 * 1024
/** 单份报告中自定义诊断段 / 渲染进程控制台尾部的字节上限。 */
const MAX_SECTION_BYTES = 64 * 1024
/** cause 链最大展开深度。 */
const MAX_CAUSE_DEPTH = 8
/** 落盘时限：超时即放弃写报告（现场重要，但不能拖住致命退出）。 */
export const CRASH_REPORT_WRITE_DEADLINE_MS = 1_000

/** 版本矩阵与环境事实，由调用方注入以便纯函数可测。 */
export interface CrashReportFacts {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  packaged: boolean
}

export interface CrashReportInput {
  /** 崩溃发生时刻（报告标题与文件名都用它）。 */
  time: Date
  source: CrashSource
  /** 故障阶段标识，如 'main-uncaught' / 'renderer-gone' / 'engine-crash-loop'。 */
  phase: string
  facts: CrashReportFacts
  error?: unknown
  /** 调用方补充的诊断文本（引擎状态、端口、profile 路径等），建议多行。 */
  diagnostics?: string
  /** 渲染进程控制台尾部（按时间顺序，最新在后）。 */
  consoleTail?: readonly string[]
}

/** 生成报告文件名（UTC，定宽，字典序即时间序）。 */
export function crashReportName(time: Date, source: CrashSource): string {
  // toISOString 形如 2026-09-26T12:34:56.789Z：`:` 与 `.` 都换成 `-`，
  // 结果必须与 CRASH_REPORT_NAME 严格对应（两者分处两处，测试锁死一致性）
  const stamp = time.toISOString().replace(/[:.]/g, '-')
  return `crash-${stamp}-${source}.log`
}

/** 渲染完整报告文本。纯函数——同样的入参总是得到同样的输出。 */
export function renderCrashReport(input: CrashReportInput): string {
  const { facts } = input
  const out: string[] = []
  out.push('DSH Desktop 崩溃报告')
  out.push('='.repeat(72))
  out.push(`时间 (UTC): ${input.time.toISOString()}`)
  out.push(`来源: ${input.source}`)
  out.push(`阶段: ${input.phase}`)
  out.push('')
  out.push('环境')
  out.push('-'.repeat(72))
  out.push(`应用版本: ${facts.appVersion}`)
  out.push(`Electron: ${facts.electron}`)
  out.push(`Chromium: ${facts.chrome}`)
  out.push(`Node: ${facts.node}`)
  out.push(`平台: ${facts.platform} ${facts.arch}`)
  out.push(`打包运行: ${facts.packaged ? '是' : '否（开发模式）'}`)

  // 三段正文都过脱敏。对已脱敏的输入是幂等的，所以调用方（引擎 stderr、渲染控制台）
  // 就算自己先抹过一遍也不会重复变形——宁可多抹一次，不留"某个调用方忘了"的口子。
  if (input.error !== undefined) {
    out.push('')
    out.push('错误')
    out.push('-'.repeat(72))
    out.push(boundHead(redactSecrets(renderError(input.error)), MAX_ERROR_BYTES))
  }

  if (input.diagnostics !== undefined && input.diagnostics.trim() !== '') {
    out.push('')
    out.push('诊断')
    out.push('-'.repeat(72))
    out.push(boundHead(redactSecrets(input.diagnostics), MAX_SECTION_BYTES))
  }

  if (input.consoleTail !== undefined && input.consoleTail.length > 0) {
    out.push('')
    out.push('渲染进程控制台（尾部）')
    out.push('-'.repeat(72))
    // 控制台取尾部：崩溃前最后几条才是现场，开头几百条无关输出没有诊断价值
    out.push(boundTail(redactSecrets(input.consoleTail.join('\n')), MAX_SECTION_BYTES))
  }

  out.push('')
  return out.join('\n')
}

/**
 * 渲染错误及其 cause 链。
 *
 * Node 的 inspect 对 Error 会自行展开 `[cause]`（cause 是非可枚举属性，但 inspect
 * 有专门的 Error 分支），并能把自引用标成 `[Circular]`——所以这里**不手工遍历**：
 * 手工 traversal 会让每一层重新渲染整棵子树，输出量随链长平方增长（实测 12 层链
 * 就膨胀到几十 KB）。
 *
 * 但 inspect 在 depth 用尽后不给任何提示，于是额外数一次链长、超出时留痕：
 * 否则读报告的人会以为 cause 链到此为止，漏掉真正的最底层根因。
 */
function renderError(error: unknown): string {
  const body = inspect(error, {
    depth: MAX_CAUSE_DEPTH,
    maxArrayLength: 100,
    maxStringLength: 8192,
    breakLength: 120,
  })
  const depth = causeChainDepth(error)
  if (depth <= MAX_CAUSE_DEPTH) return body
  return `${body}\n（cause 链共 ${String(depth)} 层，仅展开前 ${String(MAX_CAUSE_DEPTH)} 层）`
}

/**
 * 数 cause 链长度：只沿 `cause` 走，不遍历普通属性（否则一个挂在属性上的大对象
 * 就能让这里耗时不可控）。环用 seen 集检出，并以 CAP 兜住上界。
 */
function causeChainDepth(error: unknown): number {
  const cap = MAX_CAUSE_DEPTH * 4
  const seen = new Set<unknown>()
  let depth = 0
  let current: unknown = error
  while (current instanceof Error && depth < cap) {
    if (seen.has(current)) return cap
    seen.add(current)
    current = current.cause
    depth += 1
  }
  return depth
}

/** 保留前缀并截断（错误与诊断段：消息和靠前的堆栈帧最有价值）。 */
function boundHead(text: string, maxBytes: number): string {
  return bound(text, maxBytes, 'head')
}

/** 保留后缀并截断（控制台尾部：崩溃前最后几条才是现场）。 */
function boundTail(text: string, maxBytes: number): string {
  return bound(text, maxBytes, 'tail')
}

/**
 * 按字节截断并标明原始大小（便于判断"丢了什么"）。
 * 截断点会落在多字节字符中间，`toString('utf8')` 会为残字节产出 U+FFFD——
 * 必须去掉这个边界残字，否则报告里出现乱码方块。尾部截断另外对齐到行首，
 * 避免第一行是半句话被误读成完整输出。
 */
function bound(text: string, maxBytes: number, from: 'head' | 'tail'): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  const slice = from === 'head' ? buf.subarray(0, maxBytes) : buf.subarray(buf.length - maxBytes)
  let body = slice.toString('utf8')
  if (from === 'head') {
    body = body.replace(/�+$/, '')
    return `${body}\n…（已截断：原文 ${String(buf.length)} 字节，仅保留前 ${String(maxBytes)} 字节）`
  }
  // 去掉开头的残字与那半行；若整段只有一行（无换行可对齐）则保留残字处理后的结果
  const aligned = body.replace(/^�*[^\n]*\n/, '')
  body = aligned === '' ? body.replace(/^�+/, '') : aligned
  return `…（已截断：原文 ${String(buf.length)} 字节，仅保留后 ${String(maxBytes)} 字节）\n${body}`
}

/**
 * 写一份崩溃报告。返回文件路径；任何失败（目录不可写、超时）返回 null——
 * 崩溃路径上不能因为写报告失败而再抛一个错。
 */
export async function writeCrashReport(
  directory: string,
  input: CrashReportInput,
): Promise<string | null> {
  const content = renderCrashReport(input)
  const path = join(directory, crashReportName(input.time, input.source))
  try {
    mkdirSync(directory, { recursive: true })
    await withDeadline(
      // 0o600：报告含配置路径与错误对象内容，不必让同机其它用户可读
      writeFile(path, content, { encoding: 'utf8', mode: 0o600 }),
      CRASH_REPORT_WRITE_DEADLINE_MS,
    )
  } catch {
    return null
  }
  pruneCrashReports(directory)
  return path
}

function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`崩溃报告写盘超时（${String(timeoutMs)}ms）`)),
      timeoutMs,
    )
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

/**
 * 只保留最近 retained 份报告。
 * 严格按 CRASH_REPORT_NAME 匹配：日志目录里还有普通日志与用户的其它文件，
 * 清理绝不能顺手删掉它们。任何 IO 失败都静默忽略——清理是尽力而为。
 */
export function pruneCrashReports(directory: string, retained: number = CRASH_REPORTS_RETAINED): void {
  if (retained < 1) return
  let names: string[]
  try {
    names = readdirSync(directory).filter((n) => CRASH_REPORT_NAME.test(n))
  } catch {
    return
  }
  if (names.length <= retained) return
  // 文件名定宽 + UTC，字典序即时间序；倒序后第 retained 位起是旧的
  names.sort((a, b) => b.localeCompare(a))
  for (const name of names.slice(retained)) {
    try {
      unlinkSync(join(directory, name))
    } catch {
      // 单个删不掉（被占用/权限）不影响其余
    }
  }
}
