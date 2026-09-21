/**
 * electron/__tests__/node-runtime.test.ts —— resolveNodeBinary 单测。
 *
 * dsh 0.1.6-alpha.2 的原生加载器拒绝 ELECTRON_RUN_AS_NODE，resolveNodeBinary
 * 必须在打包环境优先解析捆绑的 resources/bin/node，而不是回退 electron-as-node。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveNodeBinary } from '../node-runtime'

/** 造一个假的 node 可执行文件并返回其目录（resourcesPath）。 */
function fakeResourcesWithNode() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-res-'))
  mkdirSync(join(dir, 'bin'), { recursive: true })
  const nodePath = join(dir, 'bin', 'node')
  // 写个可执行的 shell 脚本冒充 node（existsSync 只看存在性）
  writeFileSync(nodePath, '#!/bin/sh\nexit 0\n')
  chmodSync(nodePath, 0o755)
  return dir
}

const NPM_VARS = ['npm_node_execpath', 'npm_config_node_execpath', 'npm_node_install_path']

describe('resolveNodeBinary', () => {
  let savedEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    savedEnv = {}
    for (const k of NPM_VARS) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of NPM_VARS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it('打包环境优先用捆绑的 resources/bin/node（非 electron-as-node）', () => {
    const resourcesPath = fakeResourcesWithNode()
    try {
      const r = resolveNodeBinary(resourcesPath)
      expect(r.isElectron).toBe(false)
      expect(r.exec).toBe(join(resourcesPath, 'bin', 'node'))
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })

  it('开发环境：npm 注入的 node 路径优先于捆绑 node', () => {
    const resourcesPath = fakeResourcesWithNode()
    const fakeNpmNode = join(resourcesPath, 'bin', 'node') // 复用同一文件存在性
    process.env.npm_node_execpath = fakeNpmNode
    try {
      const r = resolveNodeBinary(resourcesPath)
      expect(r.isElectron).toBe(false)
      expect(r.exec).toBe(fakeNpmNode)
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })

  it('无捆绑 node 时回退到系统 PATH 上的 node（非 electron-as-node）', () => {
    // 系统 PATH 上必有 node（测试机本身跑在 node 上）
    const r = resolveNodeBinary('/nonexistent-resources-path')
    expect(r.isElectron).toBe(false)
    expect(r.exec).toBeTruthy()
  })

  it('resourcesPath 为 undefined（未打包）时不抛错', () => {
    const r = resolveNodeBinary(undefined)
    expect(r.exec).toBeTruthy()
  })
})
