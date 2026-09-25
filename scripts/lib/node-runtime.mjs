/**
 * 捆绑 Node 运行时——单一真相源。
 *
 * dsh 0.1.6-alpha.2 的 node-addon-require-builtin 在 ELECTRON_RUN_AS_NODE 模式下
 * 拿不到 V8 embedder context（has_v8_context: false），直接拒绝启动引擎
 * （"Unsupported/no-context"）。0.1.5 时"原生模块均为 N-API prebuild、打包产物
 * 无需独立 Node 运行时"的假设在 alpha.2 失效：必须用独立的真 Node 跑 dsh，
 * 不能再用 electron-as-node。
 *
 * 本模块负责构建期下载官方 Node 二进制并放进产物 resources/bin/，供
 * electron/dsh-manager.ts 的 resolveNodeBinary 在打包环境解析。after-pack.mjs
 * 调 placeNodeRuntime 写入；verify-deb / smoke-test 共用路径常量
 * 做存在性断言，避免各处硬编码不同步。
 *
 * 版本选 Node 24 LTS（Krypton），与 Electron 44.2 内嵌 Node（24.20）同大行，
 * 已实测可启动 dsh alpha.2 引擎并打印端口 URL。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, cpSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 捆绑的 Node 运行时版本。升级时同步改此处一处。 */
export const NODE_RUNTIME_VERSION = 'v24.21.0'

const DIST_BASE = 'https://nodejs.org/dist'

/** electron-builder Arch 枚举 → node 分发名用的 arch（与 after-pack.mjs 的 archName 对齐）。 */
export function nodeArch(electronArch) {
  const m = { 0: 'x86', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
  return m[electronArch] ?? 'x64'
}

/** electron platform → node 分发名用的 platform。 */
export function nodePlatform(electronPlatform) {
  if (electronPlatform === 'win32') return 'win'
  if (electronPlatform === 'darwin') return 'darwin'
  return 'linux'
}

/** 某目标平台的 node 分发 tarball 文件名。 */
export function nodeDistFilename(platform, arch) {
  const ext = platform === 'win' ? 'zip' : 'tar.gz'
  return `node-${NODE_RUNTIME_VERSION}-${platform}-${arch}.${ext}`
}

/** tarball 内顶层目录名。 */
function nodeDistTopDir(platform, arch) {
  return `node-${NODE_RUNTIME_VERSION}-${platform}-${arch}`
}

/** 产物内 node 二进制的相对路径（相对 resources/）。 */
export function nodeBinaryRelPath(platform) {
  const binName = platform === 'win' ? 'node.exe' : 'node'
  return join('bin', binName)
}

/** 缓存目录：存放下载的 tarball 与解压结果，避免每次构建重下。 */
function cacheDir() {
  return join(process.env.HOME || tmpdir(), '.cache', 'dsh-desktop-node-runtime')
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`GET ${url} 失败: HTTP ${res.status}`)
  return res.text()
}

/** 从 SHASUMS256.txt 内容里取某文件名的 sha256。 */
function sha256FromSums(sums, filename) {
  const m = sums.match(new RegExp(`^([0-9a-f]{64})\\s+\\*?${filename}$`, 'm'))
  return m ? m[1] : null
}

function sha256OfFile(filePath) {
  // 用 node -e 算 sha256，避免依赖系统 sha256sum（macOS 默认是 shasum）
  const out = spawnSync(process.execPath, ['-e', `
    const { createHash } = require('node:crypto');
    const { readFileSync } = require('node:fs');
    const h = createHash('sha256');
    h.update(readFileSync(process.argv[1]));
    process.stdout.write(h.digest('hex'));
  `, filePath], { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`计算 sha256 失败: ${out.stderr}`)
  return out.stdout.trim()
}

/** 下载并校验 tarball（带 sha256），返回本地 tarball 路径。已缓存则直接复用。 */
export async function ensureNodeDistTarball(platform, arch) {
  const filename = nodeDistFilename(platform, arch)
  const cache = cacheDir()
  mkdirSync(cache, { recursive: true })
  const tarball = join(cache, filename)
  if (existsSync(tarball) && statSync(tarball).size > 0) {
    console.log(`[node-runtime] 复用缓存 tarball: ${tarball}`)
    return tarball
  }
  const sums = await fetchText(`${DIST_BASE}/${NODE_RUNTIME_VERSION}/SHASUMS256.txt`)
  const expected = sha256FromSums(sums, filename)
  if (!expected) throw new Error(`SHASUMS256.txt 未列出 ${filename}`)
  const url = `${DIST_BASE}/${NODE_RUNTIME_VERSION}/${filename}`
  console.log(`[node-runtime] 下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载 ${url} 失败: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(tarball, buf)
  const actual = sha256OfFile(tarball)
  if (actual !== expected) {
    rmSync(tarball, { force: true })
    throw new Error(`node tarball sha256 不符：期望 ${expected}，实际 ${actual}`)
  }
  console.log(`[node-runtime] ✅ sha256 校验通过`)
  return tarball
}

/**
 * 把 node 二进制放进产物 resources/bin/（linux/darwin: bin/node；win: bin/node.exe）。
 * 返回写入的绝对路径。下载与解压均带缓存，重复构建零网络。
 */
export async function placeNodeRuntime(appResourcesDir, platform, arch) {
  const tarball = await ensureNodeDistTarball(platform, arch)
  const topDir = nodeDistTopDir(platform, arch)
  const binName = platform === 'win' ? 'node.exe' : 'node'
  const extractedBin = join(cacheDir(), 'extracted', `${platform}-${arch}`, topDir, 'bin', binName)
  if (!existsSync(extractedBin)) {
    const extractDir = join(cacheDir(), 'extracted', `${platform}-${arch}`)
    rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })
    if (platform === 'win') {
      spawnSync('unzip', ['-q', tarball, '-d', extractDir], { stdio: 'inherit' })
    } else {
      spawnSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'inherit' })
    }
  }
  if (!existsSync(extractedBin)) {
    throw new Error(`解压后未找到 node 二进制: ${extractedBin}`)
  }
  const destBinDir = join(appResourcesDir, 'bin')
  mkdirSync(destBinDir, { recursive: true })
  const destBin = join(destBinDir, binName)
  cpSync(extractedBin, destBin)
  if (platform !== 'win') chmodSync(destBin, 0o755)
  console.log(`[node-runtime] ✅ node 二进制已写入产物: ${destBin}`)
  return destBin
}
