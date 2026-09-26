/**
 * scripts/__tests__/deb-trim-rules.test.ts —— verify-deb 裁剪断言的规则测试。
 *
 * 为什么需要这层：这两组规则作用在 `dpkg-deb -c` 的**真实条目**上，而条目里既有
 * 文件也有目录（目录带结尾 `/`）。1.0.31 的 CI 就是被这个形态差异挂掉的——
 * `node-pty 非目标平台 prebuild` 的负向前瞻在目录条目 `prebuilds/` 上恰好通过
 * （后面是空串，不是 `linux-x64/`），于是 after-pack **有意保留**的容器目录被
 * 判成泄漏，发布流水线卡在最后一步。
 *
 * after-pack-filter.test.ts 拦不住这个：它喂的是抽象文件路径（`prebuilds`），
 * 而 verify-deb 拿到的是 `prebuilds/`。所以这里同时钉两件事：
 *  1. 条目形态——目录条目 vs 文件路径，两种都要覆盖；
 *  2. 与 after-pack 的方向一致——after-pack 排除的，trim 规则必须命中；
 *     after-pack 保留的，trim 规则必须不命中。两边各写各的，一致性只能这样钉。
 */
import { describe, expect, it } from 'vitest'
import { shouldExcludeWithinPackage } from '../after-pack.mjs'
import { KEEP_ASSERTIONS, TRIM_RULES } from '../lib/deb-trim-rules.mjs'

/** 取 .deb 内的真实条目形态：dpkg-deb 给目录条目补结尾 `/`。 */
const entry = (within: string, isDir = false) =>
  `./opt/DSH Desktop/resources/app/node_modules/node-pty/${within}${isDir ? '/' : ''}`

const rule = (label: string) => {
  const found = TRIM_RULES.find((r) => r.label === label)
  if (!found) throw new Error(`没有这条规则：${label}`)
  return found
}

/** 该条目会不会被任何一条 trim 规则判为泄漏。 */
const flagged = (path: string) => TRIM_RULES.filter((r) => r.re.test(path)).map((r) => r.label)

const PTY_RULE = 'node-pty 非目标平台 prebuild'
const afterPackKeeps = (within: string) =>
  shouldExcludeWithinPackage('node-pty', within, 'linux', 'x64') === false

describe('trim 规则 — node-pty prebuild 的目录条目不会被误判', () => {
  it('保留 prebuilds/ 容器目录条目本身（cpSync 必须能进这个目录）', () => {
    // 回归点：after-pack 有意保留容器（见 after-pack-filter.test.ts 的 `prebuilds` 用例），
    // 所以 verify-deb 绝不能把它算成"非目标平台 prebuild"。
    expect(afterPackKeeps('prebuilds')).toBe(true)
    expect(flagged(entry('prebuilds', true))).toEqual([])
  })

  it('保留目标平台目录条目与其二进制', () => {
    expect(afterPackKeeps('prebuilds/linux-x64')).toBe(true)
    expect(afterPackKeeps('prebuilds/linux-x64/pty.node')).toBe(true)
    expect(flagged(entry('prebuilds/linux-x64', true))).toEqual([])
    expect(flagged(entry('prebuilds/linux-x64/pty.node'))).toEqual([])
  })

  it('命中非目标平台的目录条目与其中的文件', () => {
    for (const dir of ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-arm64']) {
      expect(afterPackKeeps(`prebuilds/${dir}`), dir).toBe(false)
      expect(flagged(entry(`prebuilds/${dir}`, true)), dir).toEqual([PTY_RULE])
      expect(flagged(entry(`prebuilds/${dir}/pty.node`)), dir).toEqual([PTY_RULE])
    }
  })

  it('命中直接躺在 prebuilds/ 下的杂散文件（after-pack 也排它）', () => {
    expect(afterPackKeeps('prebuilds/stray.node')).toBe(false)
    expect(flagged(entry('prebuilds/stray.node'))).toEqual([PTY_RULE])
  })

  it('two 侧方向一致：after-pack 排掉的每个正式 prebuild 路径都被 trim 规则命中', () => {
    // 把两边的判断绑在一起，免得有人只改一侧（改了 after-pack 的排除条件却忘了
    // 同步断言，或者反过来放宽断言让泄漏溜过去）。
    const within = [
      'prebuilds',
      'prebuilds/linux-x64',
      'prebuilds/linux-x64/pty.node',
      ...['win32-x64', 'darwin-arm64', 'linux-arm64'].flatMap((d) => [
        `prebuilds/${d}`,
        `prebuilds/${d}/pty.node`,
      ]),
    ]
    for (const w of within) {
      const kept = afterPackKeeps(w)
      // 目录条目（dpkg-deb 视角）带结尾 `/`；cpSync 视角不带——两种形态都要对上
      const asEntry = flagged(`./opt/x/resources/app/node_modules/node-pty/${w}${kept ? '/' : ''}`)
      expect(asEntry.includes(PTY_RULE), `${w}（after-pack ${kept ? '保留' : '排除'}）`).toBe(!kept)
    }
  })
})

describe('trim 规则 — 其余条目规则不受目录形态影响', () => {
  it('类型声明 / 构建缓存 / 调试符号只命中文件，不命中同名目录条目', () => {
    const cases: [ruleLabel: string, file: string][] = [
      ['TypeScript 声明（*.d.ts / *.d.ts.map）', './opt/x/resources/app/node_modules/a/index.d.ts'],
      ['TypeScript 声明（*.d.ts / *.d.ts.map）', './opt/x/resources/app/node_modules/a/index.d.ts.map'],
      ['TypeScript 声明（*.d.ts / *.d.ts.map）', './opt/x/resources/app/node_modules/a/index.d.mts'],
      ['TypeScript 构建缓存（*.tsbuildinfo）', './opt/x/resources/app/node_modules/a/tsconfig.tsbuildinfo'],
      ['Windows 调试符号（*.pdb）', './opt/x/resources/app/node_modules/a/foo.pdb'],
    ]
    for (const [label, file] of cases) {
      expect(rule(label).re.test(file), file).toBe(true)
      // 目录条目：同名目录不该被当成文件命中（断言用的是 `$` 锚，天然如此）
      expect(rule(label).re.test(`${file}/`), `${file}/`).toBe(false)
    }
  })

  it('domino 测试夹具命中目录条目与其中文件', () => {
    const r = rule('domino 测试夹具')
    expect(r.re.test('./opt/x/resources/app/node_modules/@mixmark-io/domino/test/')).toBe(true)
    expect(r.re.test('./opt/x/resources/app/node_modules/@mixmark-io/domino/test/fixtures/x.html')).toBe(true)
    // 同名前缀的兄弟目录不误伤
    expect(r.re.test('./opt/x/resources/app/node_modules/@mixmark-io/domino/test-utils/x.js')).toBe(false)
    expect(r.re.test('./opt/x/resources/app/node_modules/@mixmark-io/domino/lib/index.js')).toBe(false)
  })
})

describe('保留断言 — 反向方向（裁剪误伤比裁剪失效更致命）', () => {
  it('每条保留断言都能被目标平台的真实条目满足', () => {
    const debEntries = [
      './opt/DSH Desktop/resources/app/node_modules/node-pty/prebuilds/',
      './opt/DSH Desktop/resources/app/node_modules/node-pty/prebuilds/linux-x64/',
      './opt/DSH Desktop/resources/app/node_modules/node-pty/prebuilds/linux-x64/pty.node',
    ]
    for (const assertion of KEEP_ASSERTIONS) {
      expect(
        debEntries.some((p) => p.includes(assertion.includes)),
        assertion.label,
      ).toBe(true)
    }
  })

  it('保留断言不会与裁剪规则冲突（同一路径不能既要求保留又被判泄漏）', () => {
    for (const assertion of KEEP_ASSERTIONS) {
      expect(flagged(assertion.includes), assertion.label).toEqual([])
    }
  })
})
