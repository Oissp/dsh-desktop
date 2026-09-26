/**
 * scripts/__tests__/after-pack-filter.test.ts —— 打包裁剪过滤器的行为测试。
 *
 * 这些规则决定 .deb 里有什么，且**错了不会让测试变红**——只有真机跑到
 * 终端 PTY / 加载原生模块时才崩，或体积悄悄涨回去。所以在这里把每条规则
 * 的两个方向（该排的排掉、该留的留下）都钉死。
 */
import { describe, expect, it } from 'vitest'
import { shouldExcludePath, shouldExcludeWithinPackage } from '../after-pack.mjs'

/** 默认上下文：linux-x64 目标，无 dev 依赖排除。 */
const ctx = {
  devDeps: new Set<string>(),
  devOnlyClosure: null,
  targetPlatform: 'linux',
  targetArch: 'x64',
}

const excludes = (rel: string) => shouldExcludePath(rel, ctx)

describe('shouldExcludeWithinPackage — node-pty 跨平台 prebuild', () => {
  it('保留目标平台的 prebuild（终端 PTY 功能依赖）', () => {
    expect(shouldExcludeWithinPackage('node-pty', 'prebuilds/linux-x64/pty.node', 'linux', 'x64')).toBe(false)
    expect(shouldExcludeWithinPackage('node-pty', 'prebuilds', 'linux', 'x64')).toBe(false)
  })

  it('排除其它平台的 prebuild（Windows 两个目录合计约 23 MB 死重）', () => {
    for (const dir of ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-arm64']) {
      expect(
        shouldExcludeWithinPackage('node-pty', `prebuilds/${dir}/pty.node`, 'linux', 'x64'),
        `${dir} 应被排除`,
      ).toBe(true)
    }
    expect(shouldExcludeWithinPackage('node-pty', 'prebuilds/win32-x64/conpty.pdb', 'linux', 'x64')).toBe(true)
  })

  it('包名带平台后缀的其它包不受此规则影响', () => {
    // 这条规则只认 node-pty；sharp 等走 isNonTargetPrebuild 的包名匹配
    expect(shouldExcludeWithinPackage('sharp', 'prebuilds/win32-x64/x.node', 'linux', 'x64')).toBe(false)
  })
})

describe('shouldExcludeWithinPackage — 构建与诊断产物', () => {
  it('排除类型声明与声明映射（运行时从不 require）', () => {
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'lib/index.d.ts', 'linux', 'x64')).toBe(true)
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'lib/index.d.ts.map', 'linux', 'x64')).toBe(true)
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'lib/index.d.mts', 'linux', 'x64')).toBe(true)
  })

  it('排除 tsbuildinfo 与 Windows 调试符号', () => {
    expect(shouldExcludeWithinPackage('x', 'lib/tsconfig.tsbuildinfo', 'linux', 'x64')).toBe(true)
    expect(shouldExcludeWithinPackage('x', 'build/native.pdb', 'linux', 'x64')).toBe(true)
  })

  it('保留 .js.map 与随包源码（崩溃堆栈可还原到 TS，代价仅约 1.6 MB）', () => {
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'lib/index.js.map', 'linux', 'x64')).toBe(false)
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'src/index.ts', 'linux', 'x64')).toBe(false)
    expect(shouldExcludeWithinPackage('@deepseek-ai/dsh', 'lib/index.js', 'linux', 'x64')).toBe(false)
  })
})

describe('shouldExcludeWithinPackage — domino', () => {
  it('排除 test/（占该包约 90% 体积），保留 lib/', () => {
    expect(shouldExcludeWithinPackage('@mixmark-io/domino', 'test', 'linux', 'x64')).toBe(true)
    expect(shouldExcludeWithinPackage('@mixmark-io/domino', 'test/w3c/tests.js', 'linux', 'x64')).toBe(true)
    expect(shouldExcludeWithinPackage('@mixmark-io/domino', 'lib/index.js', 'linux', 'x64')).toBe(false)
  })

  it('不误伤名字里含 test 的其它路径', () => {
    expect(shouldExcludeWithinPackage('@mixmark-io/domino', 'lib/contest.js', 'linux', 'x64')).toBe(false)
  })
})

describe('shouldExcludePath — 包根与包内两段判断', () => {
  it('scope 目录本身保留，继续向下遍历', () => {
    expect(excludes('@deepseek-ai')).toBe(false)
  })

  it('devDependencies 的包根被排除', () => {
    const withDev = { ...ctx, devDeps: new Set(['electron']) }
    expect(shouldExcludePath('electron', withDev)).toBe(true)
    expect(shouldExcludePath('@deepseek-ai/dsh', withDev)).toBe(false)
  })

  it('dev-only 传递闭包整包排除（即使非直接 devDependency）', () => {
    const withClosure = { ...ctx, devOnlyClosure: new Set(['@babel/core']) }
    expect(shouldExcludePath('@babel/core', withClosure)).toBe(true)
  })

  it('非目标平台的 prebuild 包整包排除（走包名匹配）', () => {
    expect(excludes('@koromix/koffi-win32-x64')).toBe(true)
    expect(excludes('@koromix/koffi-linux-x64')).toBe(false)
    expect(excludes('@img/sharp-darwin-arm64')).toBe(true)
  })

  it('整包排除靠包根判定 + cpSync 不下探，包内路径不会被查询', () => {
    // cpSync 对被 filter 拒绝的目录不会继续下探（实测：子路径根本不进 filter），
    // 所以"整包排除"完全由包根这一次判定完成，shouldExcludePath 不需要、也不该
    // 在包内路径上重放包根规则。这里钉住这个分工，避免有人"顺手"加上重复判断。
    const withDev = { ...ctx, devDeps: new Set(['node-pty']) }
    expect(shouldExcludePath('node-pty', withDev)).toBe(true)
    expect(shouldExcludePath('node-pty/prebuilds/linux-x64/pty.node', withDev)).toBe(false)
  })

  it('不认识的路径一律保留（不认识就保留原则）', () => {
    expect(excludes('some-pkg/data/weird.bin')).toBe(false)
    expect(excludes('some-pkg/native/addon.node')).toBe(false)
    expect(excludes('some-pkg/wasm/module.wasm')).toBe(false)
    expect(excludes('some-pkg/prebuilds/win32-x64/x.node')).toBe(false) // 非 node-pty，交给包名规则
  })
})
