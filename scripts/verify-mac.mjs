/**
 * scripts/verify-mac.mjs —— macOS 打包产物静态校验。
 *
 * 校验 .app bundle 结构、Info.plist 关键字段（bundle id / 版本）、依赖闭包
 * （@deepseek-ai/dsh、electron-updater、koffi）与 koffi 原生二进制是否按目标架构
 * 到位，以及 dmg / zip / latest-mac.yml 更新元数据是否齐备。
 * macOS CI 在打包后运行；不做 GUI 启动，避免 CI runner 上的窗口/权限波动。
 *
 * electron-builder 的 mac 产物目录：默认架构（x64）→ out/mac，其余架构 → out/mac-<arch>，
 * 因此架构从 Mach-O 二进制推断而非目录名。
 *
 * 用法：node scripts/verify-mac.mjs [out]（缺省 out）
 * 退出码：0 通过，1 失败。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { NATIVE_MODULE_FAMILIES, familyBinaryPath } from './lib/native-modules.mjs'

const outDir = resolve(process.argv[2] ?? 'out')
const BUNDLE_ID = 'com.dsh.desktop'

let failures = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failures++
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

/** 解析 Info.plist 的某字符串字段（macOS plutil 自带）。 */
function plistValue(plistPath, key) {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', plistPath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch {
    return null
  }
}

/** 从 Mach-O 二进制推断架构（arm64 / x64），失败返回 null。 */
function binaryArch(execPath) {
  try {
    const out = execFileSync('file', [execPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    if (/arm64|aarch64/.test(out)) return 'arm64'
    if (/x86_64/.test(out)) return 'x64'
  } catch {
    // 落到目录名推断
  }
  return null
}

console.log(`\n[verify-mac] 校验 ${outDir}`)

if (!existsSync(outDir)) {
  fail(`目录不存在 ${outDir}`)
} else {
  // 收集 .app bundle：out/mac（默认架构）与 out/mac-<arch>（其余架构）
  const appBundles = []
  for (const dir of readdirSync(outDir)) {
    if (dir !== 'mac' && !dir.startsWith('mac-')) continue
    const dirAbs = join(outDir, dir)
    if (!statSync(dirAbs).isDirectory()) continue
    for (const entry of readdirSync(dirAbs)) {
      if (entry.endsWith('.app')) appBundles.push({ dir, bundle: join(dirAbs, entry) })
    }
  }

  if (appBundles.length === 0) {
    fail(`未找到 out/mac 或 out/mac-*/**.app（electron-builder 应输出 mac + mac-<arch>）`)
  }

  for (const { dir, bundle } of appBundles) {
    const label = `${dir}/${bundle.slice(bundle.lastIndexOf('/') + 1)}`
    console.log(`\n[verify-mac] ${label}`)

    const contents = join(bundle, 'Contents')
    const plist = join(contents, 'Info.plist')
    if (!existsSync(plist)) {
      fail('缺 Contents/Info.plist')
    } else {
      const bundleId = plistValue(plist, 'CFBundleIdentifier')
      if (bundleId === BUNDLE_ID) {
        ok(`CFBundleIdentifier = ${bundleId}`)
      } else {
        fail(`CFBundleIdentifier 应为 ${BUNDLE_ID}，实际 ${bundleId ?? '（解析失败）'}`)
      }
      const ver = plistValue(plist, 'CFBundleShortVersionString')
      if (ver && /^\d+\.\d+\.\d+/.test(ver)) {
        ok(`CFBundleShortVersionString = ${ver}`)
      } else {
        fail(`CFBundleShortVersionString 非法：${ver ?? '（解析失败）'}`)
      }
    }

    const macosDir = join(contents, 'MacOS')
    const execs = existsSync(macosDir) ? readdirSync(macosDir).filter((f) => f !== '.DS_Store') : []
    if (execs.length === 1 && existsSync(join(macosDir, execs[0]))) {
      ok(`主可执行文件：${execs[0]}`)
    } else {
      fail(`Contents/MacOS 应恰有一个可执行文件，实际 ${execs.length ? execs.join(', ') : '（缺失）'}`)
    }
    const arch = execs.length === 1 ? binaryArch(join(macosDir, execs[0])) : null
    if (!arch) {
      fail(`无法从 Mach-O 二进制推断架构（${execs[0] ?? '无可执行文件'}）`)
    } else {
      ok(`架构：${arch}`)
      // CI 打包目标是 arm64（macos-latest arm64 runner），产物架构应匹配
      if (arch !== 'arm64') {
        fail(`产物架构 ${arch} 与预期 arm64 不符`)
      }
    }

    const appRes = join(bundle, 'Contents', 'Resources', 'app')
    const nmRoot = join(appRes, 'node_modules')
    const deps = ['@deepseek-ai/dsh', 'electron-updater', 'koffi', '@deepseek-ai/node-addon-system']
    for (const dep of deps) {
      if (existsSync(join(nmRoot, dep))) ok(`依赖闭包：${dep}`)
      else fail(`依赖闭包缺失：${dep}（dsh 引擎将无法启动）`)
    }
    if (existsSync(join(appRes, 'dist-electron', 'electron', 'main.js'))) {
      ok('主进程入口 dist-electron/electron/main.js')
    } else {
      fail('缺 dist-electron/electron/main.js')
    }

    // 原生二进制按目标架构到位。路径与 after-pack 共用 lib/native-modules.mjs，
    // 避免两处硬编码不同步（prebuild 布局变化时只改共享模块一处）。
    for (const family of NATIVE_MODULE_FAMILIES) {
      const bin = familyBinaryPath(nmRoot, family, 'darwin', arch)
      if (!bin) continue
      if (existsSync(bin)) {
        ok(`${family.name} 原生二进制（${family.scope}/${family.packageName('darwin', arch)}）`)
      } else {
        fail(`缺 ${family.name} 原生二进制 ${bin}（after-pack 补全失败）`)
      }
    }
    // koffi 包名供下方平台纯净性检查复用
    const koffiPkg = `koffi-darwin-${arch}`

    // 平台纯净性：@koromix 下不应出现非目标架构的 koffi 平台包
    const koromixDir = join(nmRoot, '@koromix')
    if (existsSync(koromixDir)) {
      const leaked = readdirSync(koromixDir).filter(
        (n) => /^koffi-(linux|win32|darwin)-/.test(n) && n !== koffiPkg,
      )
      if (leaked.length === 0) ok('无非目标 koffi 平台包泄入')
      else fail(`非目标 koffi 平台包泄入：${leaked.join(', ')}`)
    }
  }

  console.log('\n[verify-mac] 发布产物（dmg / zip / 更新元数据）')
  const dmg = readdirSync(outDir).filter((f) => f.endsWith('.dmg'))
  const zip = readdirSync(outDir).filter((f) => f.endsWith('.zip'))
  if (dmg.length > 0) ok(`dmg：${dmg.map((f) => `${f}（${(statSync(join(outDir, f)).size / 1024 / 1024).toFixed(1)} MB）`).join('， ')}`)
  else fail('无 .dmg 产物')
  if (zip.length > 0) ok(`zip：${zip.map((f) => `${f}（${(statSync(join(outDir, f)).size / 1024 / 1024).toFixed(1)} MB）`).join('， ')}`)
  else fail('无 .zip 产物（electron-updater 增量更新必需）')
  if (existsSync(join(outDir, 'latest-mac.yml'))) ok('latest-mac.yml 存在（检查更新必需）')
  else fail('缺 latest-mac.yml（electron-updater 检查更新将失效）')
}

console.log(`\n[verify-mac] ${failures === 0 ? '✓ 全部通过' : `✗ 失败 ${failures} 项`}\n`)
process.exit(failures === 0 ? 0 : 1)
