/**
 * scripts/verify-deb.mjs —— 打包产物完整性校验（PR #304 实践）。
 *
 * electron-builder 的 deb 产物最易在 after-pack.mjs 的整体复制环节出错：
   依赖闭包缺失、原生模块平台不符、非目标平台 prebuild 泄入等。CI 里仅
   `dpkg-deb -I` 打印 control 不足以发现这些。本脚本做四件事：
 *   1. magic bytes：确认是合法的 ar 归档（deb 包格式）
 *   2. 关键运行时路径：@deepseek-ai/ 闭包、koffi 原生模块、主可执行文件
 *   3. 平台纯净性：不应出现非 linux-x64 的 prebuild（arm64/win32/darwin）
 *   4. 打印体积与条目摘要
 *
 * 用法：node scripts/verify-deb.mjs [out/xxx.deb]（缺省则取 out/*.deb 第一个）
 */
import { openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { NATIVE_MODULE_FAMILIES } from './lib/native-modules.mjs'
import { nodeBinaryRelPath } from './lib/node-runtime.mjs'
import { TRIM_RULES, KEEP_ASSERTIONS } from './lib/deb-trim-rules.mjs'

const deb = process.argv[2]
  ?? readdirSync('out').map((f) => `out/${f}`).filter((f) => f.endsWith('.deb')).sort()[0]

if (!deb) {
  console.error('[verify-deb] 未找到 .deb 产物')
  process.exit(1)
}

let failures = 0
let warnings = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failures++
}
const warn = (msg) => {
  console.warn(`  ⚠ ${msg}`)
  warnings++
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

/**
 * 读出 .deb 里单个文件的文本内容（失败返回 null）。
 *
 * 用管道而不是 `dpkg-deb -x` 全量解包：这个包解开后 600MB+，只为读一个几百字节的
 * .desktop 不值当，也白占 CI 的磁盘与时间。deb 路径与成员名都作为位置参数传给
 * sh（不拼进命令串），所以路径里带空格或引号都不会被当成 shell 语法。
 */
function readDebFile(debPath, member) {
  const res = spawnSync(
    'sh',
    ['-c', 'dpkg-deb --fsys-tarfile "$1" | tar -xOf - "$2"', 'sh', debPath, member],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
  if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout === '') return null
  return res.stdout
}

console.log(`\n[verify-deb] 校验 ${deb}（${(statSync(deb).size / 1024 / 1024).toFixed(1)} MB）`)

// 1. magic bytes：deb 是 ar 归档，以 "!<arch>\n"（8 字节）开头，紧随的成员名为
//    "debian-binary"（ar 头部成员名字段为 16 字节，偏移 8..24）。只读前 68 字节
//    足够覆盖 magic + 首个 ar 头，避免把 100MB+ 的 deb 整体读进内存。
const fd = openSync(deb, 'r')
const buf = Buffer.alloc(68)
const bytesRead = readSync(fd, buf, 0, 68, 0)
closeSync(fd)
if (bytesRead >= 24) {
  const magic = buf.subarray(0, 8).toString('latin1')
  // 成员名是 16 字节、空格或 '/' 填充，trim 后应为 "debian-binary" 或
  // "debian-binary/"（ar 成员名常以 '/' 结尾，trim 不去 '/'）。
  const member = buf.subarray(8, 24).toString('latin1').trim().replace(/\/+$/, '')
  if (magic === '!<arch>\n' && member === 'debian-binary') {
    ok('magic bytes：合法 deb（ar 归档 + debian-binary）')
  } else {
    fail(`magic bytes 不符：magic=${JSON.stringify(magic)} member=${JSON.stringify(member)}`)
  }
} else {
  fail(`文件过短，无法读取 ar 头（${bytesRead} 字节）`)
}

// 后续校验基于 dpkg-deb 内容清单。大 deb 的清单可能数 MB，execFileSync 默认
// maxBuffer=1MB 会 ENOBUFS，这里放到 64MB。
const res = spawnSync('dpkg-deb', ['-c', deb], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (res.status !== 0) {
  fail(`dpkg-deb -c 失败（status=${res.status}）：${res.stderr?.trim() ?? ''}`)
  console.error(`\n[verify-deb] ✗ 无法读取内容清单，终止\n`)
  process.exit(1)
}
// dpkg-deb -c 输出形如 "drwxr-xr-x 0/0  0 2026-..  ./path/"，取从 './' 起的路径
const entries = res.stdout
  .split('\n')
  .map((line) => {
    const m = line.match(/(\.\/\S.*)$/)
    return m ? m[1] : ''
  })
  .filter(Boolean)

console.log('\n[verify-deb] 关键运行时路径')
const has = (pred) => entries.some(pred)
if (has((p) => p.includes('/node_modules/@deepseek-ai/'))) {
  ok('@deepseek-ai/ 依赖闭包存在')
} else {
  fail('缺 @deepseek-ai/ 依赖闭包（dsh 引擎将无法启动）')
}
// 原生模块平台二进制：after-pack 已在构建期断言它们进产物，这里是最终 .deb 内容
// 的兜底校验——若 cpSync filter 误排（after-pack 通过但 deb 里没有），此处必须
// 失败，否则坏包带病发版、引擎在加载原生模块时崩溃。路径定义与 after-pack 共用
// lib/native-modules.mjs，保证两边查的是同一处。
for (const family of NATIVE_MODULE_FAMILIES) {
  const pkgName = family.packageName('linux', 'x64')
  if (!pkgName) continue
  const rel = family.binaryPath(join('node_modules', family.scope, pkgName), 'linux', 'x64')
  if (has((p) => p.includes(rel))) {
    ok(`${family.name} 原生二进制（${family.scope}/${pkgName}）存在`)
  } else {
    // after-pack 的 ensureFamilyPlatformPackage 负责补全；此处缺失说明补全后
    // 又被 cpSync filter 误排，或 CI 容器内 pnpm 未装该 optionalDep + npm pack 兜底失败。
    fail(`缺 ${family.scope}/${pkgName} 原生二进制（${rel}）——after-pack 补全或复制环节异常`)
  }
}
// 主可执行文件：opt/<productName>/ 下无扩展名的可执行
if (has((p) => /^\.\/opt\/[^/]+\/[^/]+$/.test(p))) {
  ok('主可执行文件存在')
} else {
  fail('未找到主可执行文件')
}

// 捆绑 Node 运行时：dsh 0.1.6-alpha.2 拒绝 ELECTRON_RUN_AS_NODE，打包产物必须
// 带独立 Node 二进制供 dsh-manager spawn 引擎。缺失则装上即卡在启动页（1.0.28 回归根因）。
// 不硬编码 productName：匹配 opt/<name>/resources/bin/node 即可。
const nodeRel = `resources/${nodeBinaryRelPath('linux')}`
if (has((p) => p.includes(`/opt/`) && p.includes(nodeRel))) {
  ok(`捆绑 Node 运行时存在（${nodeRel}）`)
} else {
  fail(`缺捆绑 Node 运行时（${nodeRel}）——after-pack 未写入，引擎将无法启动`)
}

console.log('\n[verify-deb] 平台纯净性（不应有非 linux-x64 的 prebuild）')
// 收集所有 node_modules 下的包名（顶层或 @scope/name），去重
const pkgs = new Set()
for (const p of entries) {
  const m = p.match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
  if (m) pkgs.add(m[1])
}
// 平台 prebuild 包名形如 <pkg>-<platform>-<arch>；目标是 linux-x64，
// 其余 platform/arch 组合都是非目标 prebuild，不该进 x64 产物
const NON_TARGET = /-(linux|win32|darwin|freebsd)-(arm64|ia32|armv7l|x64)$/
const leaked = [...pkgs].filter((n) => NON_TARGET.test(n) && !n.endsWith('-linux-x64'))
if (leaked.length === 0) {
  ok('无非目标平台 prebuild 泄入')
} else {
  fail(`非目标平台 prebuild 泄入：${leaked.join(', ')}`)
}

console.log('\n[verify-deb] 产物裁剪（包内构建产物不应进包）')
// after-pack 的 shouldExcludeWithinPackage 负责剔除包内的构建/诊断产物。这些不影响
// 启动，但纯属死重（实测 node-pty 跨平台 prebuild ~23 MB、domino test/ ~7 MB、
// 类型声明 ~11 MB）。此处做回归校验：一旦裁剪逻辑失效（例如 filter 改回只判包根），
// 体积会悄悄涨回去、而功能测试全绿，所以必须在这里显式失败。
for (const rule of TRIM_RULES) {
  const hits = entries.filter((p) => rule.re.test(p))
  if (hits.length === 0) {
    ok(`已裁剪：${rule.label}`)
  } else {
    fail(`未裁剪：${rule.label}（${hits.length} 项，如 ${hits[0].slice(2)}）——${rule.hint}`)
  }
}
// 反向断言：裁剪绝不能误伤真正需要的东西（终端 PTY 功能依赖 pty.node）
for (const assertion of KEEP_ASSERTIONS) {
  if (has((p) => p.includes(assertion.includes))) {
    ok(`保留：${assertion.label}`)
  } else {
    fail(assertion.hint)
  }
}

console.log('\n[verify-deb] 桌面集成（.desktop + hicolor 图标）')
// .desktop 文件应在 /usr/share/applications/ 下
const desktopFiles = entries.filter((p) => p.startsWith('./usr/share/applications/') && p.endsWith('.desktop'))
// .desktop 的**文件名**与其中的 StartupWMClass 都必须等于 package.json 的
// desktopName（去掉 .desktop 后缀），因为同一个值也是 Electron 的 app_id / X11
// WM_CLASS。三者不一致时 X11 会话关联不到启动器条目（任务栏重复/无关联图标），
// Wayland 走 app_id 却看不出问题——所以要在这里从**产物**里读回来验，而不是只看
// 配置文件：StartupWMClass 的回退（缺 desktopName 时取 productName）是
// electron-builder 的行为，配置里看不出来。
const pkgMeta = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const rawDesktopName = typeof pkgMeta.desktopName === 'string' ? pkgMeta.desktopName.trim() : ''
// Electron 与 electron-builder 都会把结尾的 .desktop 去掉，比较时统一
const identity = rawDesktopName.replace(/\.desktop$/, '')
if (identity === '') {
  fail('package.json 缺 desktopName——app_id / StartupWMClass 无法对齐，X11 下窗口关联不到启动器条目')
} else {
  const expected = `./usr/share/applications/${identity}.desktop`
  if (entries.includes(expected)) {
    ok(`.desktop 文件名与 desktopName 一致：${expected.slice(2)}`)
  } else {
    const found = desktopFiles.length > 0 ? desktopFiles[0].slice(2) : '（无）'
    fail(`.desktop 文件名应为 ${expected.slice(2)}，实际 ${found}——linux.syncDesktopName 未生效或 desktopName 不一致`)
  }
  const entry = readDebFile(deb, expected)
  if (entry === null) {
    warn(`未能从 .deb 读出 ${expected.slice(2)}，跳过 StartupWMClass 校验（不影响安装）`)
  } else {
    const line = entry.split('\n').find((l) => l.startsWith('StartupWMClass='))
    const actual = line === undefined ? null : line.slice('StartupWMClass='.length).trim()
    if (actual === identity) {
      ok(`StartupWMClass 与运行时 app_id 一致：${identity}`)
    } else {
      fail(
        `StartupWMClass=${actual ?? '（无该字段）'}，应为 ${identity}`
        + '——缺 desktopName 时 electron-builder 会回退成 productName，X11 下窗口关联不到启动器条目',
      )
    }
  }
}
// .desktop 文件应在 /usr/share/applications/ 下（文件名是否正确见上面的身份断言）
if (desktopFiles.length > 0) {
  ok(`.desktop 文件存在：${desktopFiles[0].slice(2)}`)
} else {
  fail('缺 /usr/share/applications/*.desktop（应用不会出现在程序菜单）')
}
// hicolor 图标：freedesktop 标准尺寸 16/32/48/64/128/256/512（不含 1024，
// index.theme 不声明 1024 目录，装到 1024x1024 桌面环境找不到 → 菜单无图标）
const hicolorIcons = entries.filter((p) =>
  /^\.\/usr\/share\/icons\/hicolor\/(\d+)x\1\/apps\/[^/]+\.png$/.test(p),
)
const sizes = hicolorIcons
  .map((p) => p.match(/hicolor\/(\d+)x\1\//)?.[1])
  .filter(Boolean)
  .sort((a, b) => Number(a) - Number(b))
if (sizes.length === 0) {
  fail('缺 /usr/share/icons/hicolor/*/apps/ 图标（菜单不显示程序图标）')
} else if (sizes.includes('1024') && sizes.length === 1) {
  fail(`仅有 1024x1024 图标，hicolor 不声明该尺寸 → 菜单不显示（需 16–512 多尺寸）`)
} else {
  ok(`hicolor 图标尺寸：${sizes.join(', ')}`)
}

console.log(`\n[verify-deb] 条目总数：${entries.length}`)
if (failures > 0) {
  console.error(`\n[verify-deb] ✗ 失败 ${failures} 项${warnings ? `，警告 ${warnings} 项` : ''}\n`)
  process.exit(1)
}
if (warnings > 0) {
  console.warn(`\n[verify-deb] ✓ 通过（${warnings} 项警告，见上）\n`)
} else {
  console.log('\n[verify-deb] ✓ 全部通过\n')
}
