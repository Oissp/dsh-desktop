import { describe, expect, it } from 'vitest'
import { diffStaleBundles } from '../profile-setup'

describe('diffStaleBundles', () => {
  const managed = ['dsh-desktop-archived']

  it('返回清单中已移除的裸包名插件', () => {
    const registered = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'harness-memory', 'dsh-desktop-archived']
    expect(diffStaleBundles(registered, managed)).toEqual(['harness-memory'])
  })

  it('不动 @scope 包与当前清单插件', () => {
    const registered = ['@deepseek-ai/dsh-base', 'dsh-desktop-archived', '@some/engine-plugin']
    expect(diffStaleBundles(registered, managed)).toEqual([])
  })

  it('全部为当前清单插件时返回空', () => {
    expect(diffStaleBundles(['dsh-desktop-archived'], managed)).toEqual([])
  })

  it('空注册表返回空', () => {
    expect(diffStaleBundles([], managed)).toEqual([])
  })
})
