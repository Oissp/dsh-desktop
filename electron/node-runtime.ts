/**
 * electron/node-runtime.ts —— 解析运行 dsh 引擎用的 Node 二进制。
 *
 * 从 dsh-manager.ts 抽出以便单测：不依赖 electron 模块，只读 process.env /
 * process.resourcesPath / 文件系统。
 *
 * 背景见 scripts/lib/node-runtime.mjs：dsh 0.1.6-alpha.2 的原生加载器拒绝
 * ELECTRON_RUN_AS_NODE，打包环境必须用捆绑的真 Node，不能再走 electron-as-node。
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export interface ResolvedNode {
  exec: string
  /** 是否为 electron-as-node（true 则需设 ELECTRON_RUN_AS_NODE=1）。 */
  isElectron: boolean
}

/** 在 PATH 上查找可执行文件（command -v），找不到返回 null。 */
function which(cmd: string): string | null {
  if (process.platform === 'win32') {
    // Windows 无 sh -c command -v；用 where。本项目当前不发 Windows 包，仅兜底。
    try {
      const out = execFileSync('where', [cmd], { encoding: 'utf8' }).split('\n')[0]?.trim()
      return out || null
    } catch {
      return null
    }
  }
  try {
    const out = execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim()
    return out || null
  } catch {
    return null
  }
}

/**
 * 解析运行 dsh 引擎用的 Node 二进制。
 *
 * 解析顺序：
 *  1. 开发环境：npm/pnpm 注入的 node 路径（process.env.npm_node_execpath 等）——
 *     故 `pnpm dev` 一直用真 Node 跑引擎，alpha.2 在 dev 下不会暴露此问题。
 *  2. 打包环境：随产物发布的 Node 运行时（resources/bin/node）
 *  3. 兜底：系统 PATH 上的 node（用户自装了 node 时可用）
 *  4. 最后兜底：electron-as-node（alpha.2 下引擎会崩，仅给旧 dsh/调试保留）
 *
 * @param resourcesPath 打包环境为 process.resourcesPath；单测可注入。
 */
export function resolveNodeBinary(
  resourcesPath: string | undefined = process.resourcesPath,
): ResolvedNode {
  // 1. 开发环境
  const fromNpm =
    process.env.npm_node_execpath ||
    process.env.npm_config_node_execpath ||
    process.env.npm_node_install_path
  if (fromNpm && existsSync(fromNpm)) {
    return { exec: fromNpm, isElectron: false }
  }
  // 2. 打包环境：捆绑的 Node 运行时
  const binName = process.platform === 'win32' ? 'node.exe' : 'node'
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'bin', binName)
    if (existsSync(bundled)) {
      return { exec: bundled, isElectron: false }
    }
  }
  // 3. 系统 PATH 上的 node
  const sysNode = which('node')
  if (sysNode) {
    return { exec: sysNode, isElectron: false }
  }
  // 4. 最后兜底：electron-as-node（alpha.2 会崩，但保留给无 node 可用的极端情况）
  return { exec: process.execPath, isElectron: true }
}
