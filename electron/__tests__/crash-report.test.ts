/**
 * electron/__tests__/crash-report.test.ts —— 崩溃报告渲染、落盘与清理。
 *
 * 崩溃报告是**故障路径上的最后一道输出**：它只在主进程要死、渲染进程已死、
 * 引擎熔断这三种时候被调用，平时没人看。所以正确性不能靠"跑一次试试"——
 * 真出事那天才发现报告是空的/写不出来就晚了。这里把三类保证钉死：
 *  1. 现场完整（版本矩阵、非可枚举的 cause 链、控制台尾部）；
 *  2. 有界（错误对象可以是任意形状，报告不能跟着无界增长或死循环）；
 *  3. 清理不越界（只删自己命名的文件，绝不碰用户日志目录里的其它东西）。
 */
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRASH_REPORT_NAME,
  crashReportName,
  pruneCrashReports,
  renderCrashReport,
  writeCrashReport,
  type CrashReportInput,
} from '../crash-report.js'

const tmpDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-crash-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

const FACTS = {
  appVersion: '1.0.31',
  electron: '44.4.5',
  chrome: '140.0.0.0',
  node: '22.19.0',
  platform: 'linux',
  arch: 'x64',
  packaged: true,
}

function input(over: Partial<CrashReportInput> = {}): CrashReportInput {
  return {
    time: new Date('2026-09-26T12:34:56.789Z'),
    source: 'main',
    phase: 'main-uncaught',
    facts: FACTS,
    ...over,
  }
}

describe('crashReportName', () => {
  it('文件名可被 CRASH_REPORT_NAME 匹配，且 : 被替换（FAT/Windows 安全）', () => {
    const name = crashReportName(new Date('2026-09-26T12:34:56.789Z'), 'engine')
    expect(name).toBe('crash-2026-09-26T12-34-56-789Z-engine.log')
    expect(CRASH_REPORT_NAME.test(name)).toBe(true)
    expect(name).not.toContain(':')
  })

  it('字典序 = 时间序（prune 的排序前提）', () => {
    const names = [
      crashReportName(new Date('2026-09-26T12:34:56.789Z'), 'main'),
      crashReportName(new Date('2026-01-02T00:00:00.000Z'), 'main'),
      crashReportName(new Date('2026-09-26T12:34:56.900Z'), 'renderer'),
    ]
    expect([...names].sort()).toEqual([names[1], names[0], names[2]])
  })

  it('不匹配形近但不合法的名字（防止误删用户文件）', () => {
    for (const bad of [
      'crash-2026-09-26T12-34-56-789Z-bogus.log',
      'crash-2026-09-26T12-34-56-789Z-main.txt',
      'crash-2026-09-26-main.log',
      'crash-main.log',
      // 前缀/后缀夹带：正则锚定了 ^ 与 $
      'xcrash-2026-09-26T12-34-56-789Z-main.log',
      'crash-2026-09-26T12-34-56-789Z-main.log.bak',
      'dsh-desktop.log',
    ]) {
      expect(CRASH_REPORT_NAME.test(bad), bad).toBe(false)
    }
  })
})

describe('renderCrashReport — 现场完整性', () => {
  it('版本矩阵、来源与阶段都在报告头部', () => {
    const report = renderCrashReport(input({ source: 'engine', phase: 'engine-crash-loop' }))
    expect(report).toContain('2026-09-26T12:34:56.789Z')
    expect(report).toContain('来源: engine')
    expect(report).toContain('阶段: engine-crash-loop')
    expect(report).toContain('应用版本: 1.0.31')
    expect(report).toContain('Electron: 44.4.5')
    expect(report).toContain('平台: linux x64')
    expect(report).toContain('打包运行: 是')
  })

  it('展开 Error.cause 链——cause 是非可枚举属性，默认 inspect 看不见', () => {
    const root = new Error('根因：profile 被写坏')
    const middle = new Error('中间层', { cause: root })
    const top = new Error('顶层失败', { cause: middle })
    const report = renderCrashReport(input({ error: top }))
    expect(report).toContain('顶层失败')
    expect(report).toContain('中间层')
    expect(report).toContain('根因：profile 被写坏')
    expect(report).toContain('[cause]')
    // 顶层在最前，根因在最后（顺序不能反）
    expect(report.indexOf('顶层失败')).toBeLessThan(report.indexOf('根因：profile 被写坏'))
    // 链在 8 层以内 → 不该出现截断留痕
    expect(report).not.toContain('仅展开前')
  })

  it('非 Error 的抛出值也能落盘（字符串 / 普通对象 / undefined 不报错）', () => {
    expect(renderCrashReport(input({ error: '裸字符串抛出' }))).toContain('裸字符串抛出')
    expect(renderCrashReport(input({ error: { code: 'EACCES', path: '/x' } }))).toContain('EACCES')
    // 无错误时不应出现空的「错误」段
    expect(renderCrashReport(input())).not.toContain('错误\n')
  })

  it('诊断段与控制台尾部各自成段', () => {
    const report = renderCrashReport(
      input({
        diagnostics: '引擎运行: 否\n引擎端口: —',
        consoleTail: ['[error] Failed to fetch /api/host', '[warning] 重连中'],
      }),
    )
    expect(report).toContain('诊断')
    expect(report).toContain('引擎运行: 否')
    expect(report).toContain('渲染进程控制台（尾部）')
    expect(report).toContain('[error] Failed to fetch /api/host')
  })
})

describe('renderCrashReport — 有界性', () => {
  it('超长错误消息不会让报告无界增长', () => {
    const report = renderCrashReport(input({ error: new Error('x'.repeat(500_000)) }))
    // 256 KiB 错误段上限 + 头部余量
    expect(Buffer.byteLength(report, 'utf8')).toBeLessThan(300 * 1024)
  })

  it('错误、诊断、控制台三段都过脱敏——报告会被贴进公开 issue', () => {
    const report = renderCrashReport(
      input({
        error: new Error('请求失败: https://api.example.com/v1?token=supersecret123'),
        diagnostics: 'Authorization: Bearer abcdefghijklmnop\napiKey=hunter2hunter2\nmax_tokens=4096',
        consoleTail: ['[error] POST /api/x?key=leakedkey123 401'],
      }),
    )
    expect(report).not.toContain('supersecret123')
    expect(report).not.toContain('abcdefghijklmnop')
    expect(report).not.toContain('hunter2hunter2')
    expect(report).not.toContain('leakedkey123')
    expect(report).toContain('[已隐去]')
    // 非敏感的诊断线索必须留下，否则报告就没用了
    expect(report).toContain('max_tokens=4096')
    expect(report).toContain('POST /api/x')
    expect(report).toContain('请求失败')
  })

  it('cause 自我引用不会死循环，也不会把展开深度误算成环上界', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    a.cause = b
    const report = renderCrashReport(input({ error: a }))
    expect(report).toContain('a')
    expect(report).toContain('b')
    // 环被 cap 兜住：报告长度有限，且留痕里的层数是上界而非无限
    expect(Buffer.byteLength(report, 'utf8')).toBeLessThan(64 * 1024)
    expect(report).toContain(`仅展开前 8 层`)
  })

  it('cause 链超过展开深度时留痕（否则根因被静默截掉）', () => {
    let err: Error = new Error('第 0 层')
    for (let i = 1; i <= 12; i++) err = new Error(`第 ${String(i)} 层`, { cause: err })
    const report = renderCrashReport(input({ error: err }))
    expect(report).toContain('第 12 层')
    expect(report).toContain('cause 链共 13 层，仅展开前 8 层')
    // 第 0 层在展开范围外，证明留痕对应的是真实截断而非误报
    expect(report).not.toContain('第 0 层')
  })

  it('超长控制台尾部被截断且标明原始大小，保留的是尾部', () => {
    const tail = Array.from({ length: 5_000 }, (_, i) => `[error] 第 ${String(i)} 条：${'y'.repeat(40)}`)
    const report = renderCrashReport(input({ consoleTail: tail }))
    expect(report).toContain('已截断')
    expect(report).toContain('仅保留后')
    expect(Buffer.byteLength(report, 'utf8')).toBeLessThan(128 * 1024)
    // 保留的是**尾部**（最近发生的事），不是开头
    expect(report).toContain('第 4999 条')
    expect(report).not.toContain('第 0 条：')
  })

  it('按字节截断不会在多字节字符中间劈开（报告里不能出现替换字符）', () => {
    // 纯中文：每个字符 3 字节，65536 不是 3 的倍数，必然落在字符中间
    const tail = Array.from({ length: 400 }, (_, i) => `[error] 中文诊断第${String(i)}条${'诊'.repeat(60)}`)
    const report = renderCrashReport(input({ consoleTail: tail }))
    expect(report).toContain('仅保留后')
    expect(report).not.toContain('�')
    // 截断后首行必须是完整的日志行（对齐到行首）
    const section = report.slice(report.indexOf('渲染进程控制台（尾部）'))
    const firstBodyLine = section.split('\n').find((l) => l.startsWith('[error]'))
    expect(firstBodyLine).toMatch(/^\[error\] 中文诊断第\d+条诊+$/)
  })

  it('超长错误段同样不留替换字符', () => {
    const report = renderCrashReport(input({ error: new Error('错'.repeat(200_000)) }))
    expect(report).not.toContain('�')
  })
})

describe('writeCrashReport', () => {
  it('创建目录、写入文件、返回路径', async () => {
    const dir = join(tempDir(), 'logs')
    const path = await writeCrashReport(dir, input({ error: new Error('落盘测试') }))
    expect(path).toBe(join(dir, 'crash-2026-09-26T12-34-56-789Z-main.log'))
    expect(readFileSync(path as string, 'utf8')).toContain('落盘测试')
  })

  it('报告权限为 0600（含配置路径与错误内容，不对同机其它用户开放）', async () => {
    const path = await writeCrashReport(tempDir(), input())
    const mode = statSync(path as string).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('目录不可写时返回 null 而不抛出（崩溃路径上不能再炸一次）', async () => {
    // 用一个已存在的**文件**当目录：mkdirSync 会失败
    const dir = tempDir()
    const asFile = join(dir, 'not-a-dir')
    writeFileSync(asFile, 'x')
    await expect(writeCrashReport(asFile, input())).resolves.toBeNull()
  })
})

describe('pruneCrashReports', () => {
  function seed(dir: string, count: number): string[] {
    const names: string[] = []
    for (let i = 0; i < count; i++) {
      // 每日一份，时间递增
      const day = String(i + 1).padStart(2, '0')
      const name = crashReportName(new Date(`2026-09-${day}T00:00:00.000Z`), 'main')
      writeFileSync(join(dir, name), 'x')
      names.push(name)
    }
    return names
  }

  it('只保留最近 N 份（按时间序，删最旧）', () => {
    const dir = tempDir()
    const names = seed(dir, 15)
    pruneCrashReports(dir, 10)
    const left = readdirSync(dir).sort()
    expect(left).toHaveLength(10)
    expect(left).toEqual(names.slice(5).sort())
  })

  it('份数未超上限时不动任何文件', () => {
    const dir = tempDir()
    const names = seed(dir, 3)
    pruneCrashReports(dir, 10)
    expect(readdirSync(dir).sort()).toEqual(names.sort())
  })

  it('绝不删除不匹配命名规则的文件（用户日志目录里还有普通日志）', () => {
    const dir = tempDir()
    seed(dir, 15)
    const bystanders = ['dsh-desktop-2026-09-26.log', 'crash-notes.txt', 'config.json']
    for (const b of bystanders) writeFileSync(join(dir, b), 'keep me')
    pruneCrashReports(dir, 1)
    for (const b of bystanders) {
      expect(readdirSync(dir), b).toContain(b)
    }
    expect(readdirSync(dir).filter((n) => CRASH_REPORT_NAME.test(n))).toHaveLength(1)
  })

  it('目录不存在时静默返回（启动早期日志目录可能尚未建）', () => {
    expect(() => {
      pruneCrashReports(join(tempDir(), 'nope'), 10)
    }).not.toThrow()
  })

  it('retained < 1 时不动手（避免误传 0 清空全部）', () => {
    const dir = tempDir()
    seed(dir, 3)
    pruneCrashReports(dir, 0)
    expect(readdirSync(dir)).toHaveLength(3)
  })
})
