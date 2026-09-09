/**
 * 原生模块平台包族定义——单一真相源。
 *
 * after-pack.mjs（构建期补全 + 产物断言）、verify-deb.mjs / verify-mac.mjs /
 * smoke-test.mjs（产物校验）共用此定义，避免各处硬编码包名/路径不同步：
 * 某个 prebuild 布局变化时只改这里一处，所有校验同步生效。
 *
 * 这些族用 optionalDependencies 分发各平台 prebuild 二进制，运行时按包名
 * require.resolve 平台包并加载 .node，故打包产物必须含目标平台包。
 * packageName 返回 null 表示该目标平台/架构不需要此族原生二进制。
 */
import { join } from 'node:path'

export const NATIVE_MODULE_FAMILIES = [
  {
    name: 'koffi',
    // koffi：dsh-subprocess-local 硬依赖，顶层 import 无平台门控（031：win 交叉打包必补）。
    scope: '@koromix',
    packageName: (platform, arch) => (arch === 'x64' || arch === 'arm64') ? `koffi-${platform}-${arch}` : null,
    // koffi 主包 loadDynamic 按 platform_abi/koffi.node 查找。
    binaryPath: (pkgDir, platform, arch) => join(pkgDir, `${platform}_${arch}`, 'koffi.node'),
  },
  {
    name: 'node-addon-system',
    // node-addon-system：0.1.5 起取代 fs-ext 的 flock（session 写锁），linux/darwin N-API prebuild。
    // flock 仅 POSIX（linux/darwin）；Windows 走命名内核信号量，无需此包。
    scope: '@deepseek-ai',
    packageName: (platform, arch) =>
      (platform === 'linux' || platform === 'darwin') ? `node-addon-system-${platform}-${arch}` : null,
    // linux 仅有 glibc prebuild（bin/glibc/system.node）；musl（Alpine 等）暂不支持，
    // 若未来需要 musl 变体需在此区分。darwin 的 prebuild 在 bin/system.node。
    binaryPath: (pkgDir, platform) =>
      platform === 'linux' ? join(pkgDir, 'bin', 'glibc', 'system.node') : join(pkgDir, 'bin', 'system.node'),
  },
]

/** node_modules 根目录下某族平台包的目录绝对路径；该平台不需要时返回 null。 */
export function familyPackageDir(nmRoot, family, platform, arch) {
  const pkgName = family.packageName(platform, arch)
  if (!pkgName) return null
  return join(nmRoot, family.scope, pkgName)
}

/** 某族平台包的原生二进制绝对路径；该平台不需要时返回 null。 */
export function familyBinaryPath(nmRoot, family, platform, arch) {
  const pkgDir = familyPackageDir(nmRoot, family, platform, arch)
  if (!pkgDir) return null
  return family.binaryPath(pkgDir, platform, arch)
}
