import { describe, expect, it } from 'vitest'
import { diffStaleBundles } from '../profile-setup'

describe('diffStaleBundles', () => {
  const managed = ['dsh-desktop-archived']
  /** 桌面端安装过的 bundle（安装目录带 .dsh-desktop-managed 标记）。 */
  const desktopInstalled = (names: string[]) => (name: string) => names.includes(name)

  it('返回清单中已移除的桌面端安装插件', () => {
    const registered = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'harness-memory', 'dsh-desktop-archived']
    const installed = desktopInstalled(['harness-memory', 'dsh-desktop-archived'])
    expect(diffStaleBundles(registered, managed, installed)).toEqual(['harness-memory'])
  })

  it('不动 @scope 引擎包（桌面端从未安装过）', () => {
    const registered = ['@deepseek-ai/dsh-base', 'dsh-desktop-archived', '@some/engine-plugin']
    expect(diffStaleBundles(registered, managed, desktopInstalled(['dsh-desktop-archived']))).toEqual([])
  })

  it('不动用户自装的裸包名插件（无桌面端标记）', () => {
    // 0.1.6-alpha.2 起官方插件管理页可以装这类包，它们与伴随插件同处
    // dsh.profile.bundles；按包名启发式会被误判成过期条目并取消登记。
    const registered = ['dsh-desktop-archived', 'dsh-plugin-foo']
    expect(diffStaleBundles(registered, managed, desktopInstalled(['dsh-desktop-archived']))).toEqual([])
  })

  it('全部为当前清单插件时返回空', () => {
    expect(diffStaleBundles(['dsh-desktop-archived'], managed, desktopInstalled(['dsh-desktop-archived']))).toEqual([])
  })

  it('空注册表返回空', () => {
    expect(diffStaleBundles([], managed, desktopInstalled([]))).toEqual([])
  })
})
