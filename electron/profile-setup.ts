/**
 * electron/profile-setup.ts —— 确保 dsh profile 已初始化并安装本地伴随插件。
 *
 * 首次启动：dsh 引擎会初始化 profile（下载依赖，耗时）。本模块负责在
 * profile 就绪后把本地插件安装进去：
 *  1. 复制 plugins/<name> → profiles/web/node_modules/<name>
 *  2. 在 profiles/web/package.json 的 dsh.profile.bundles 里登记每个插件
 *
 * 之后启动：插件已存在，直接跳过。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activeCompanionPlugins } from './plugin-manifest.js'
import { healCorruptConfig } from './guard-snapshot.js'

/**
 * 需要安装进 profile 的本地插件（dsh bundle 格式）。
 * 从 plugin-manifest.ts 的声明式清单读取（单一来源），
 * 不再硬编码——新增/禁用插件只改清单不改安装逻辑。
 */
const BUNDLE_PLUGINS = activeCompanionPlugins().map((p) => p.id)

/**
 * 桌面端安装标记：installOne 复制插件后写入该文件，清理时只删除带标记的
 * 目录——用户手动装进 profile 的插件不携带标记，仅取消登记、保留源码。
 */
const DESKTOP_MANAGED_MARKER = '.dsh-desktop-managed'

/**
 * web profile 的核心 in-box bundle（来自 dsh-app-boot 的 PROFILE_TEMPLATES.web）。
 * 坏配置自愈重建时必须保留这些核心层，否则 dsh 会丢掉 base/web-app，
 * 启动后核心功能缺失或引用未定义。本地插件叠在核心层之后。
 */
const CORE_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/**
 * 计算应从 profile 清理的过期 bundle：非核心层、非当前清单、且为裸包名
 * （伴随插件都是裸包名，@scope 的是引擎/核心包）的已登记 bundle。
 * 清单移除某插件（如旧版 harness-memory）后，旧安装仍残留在 bundles 与
 * node_modules，dsh 会继续加载并在插件列表显示——这里负责收尾。
 */
export function diffStaleBundles(registered: string[], managed: string[]): string[] {
  return registered.filter(
    (name) => !name.startsWith('@') && !CORE_PROFILE_BUNDLES.includes(name) && !managed.includes(name),
  )
}

export type ProfileSetupResult =
  | { status: 'ready' } // profile 就绪且插件已安装
  | { status: 'needs-priming' } // profile 尚未初始化，需要先跑一次引擎
  | { status: 'skip'; reason: string } // 无法安装（非致命，相关功能降级）

/** 插件源码目录（开发/打包后都在 app 目录内）。 */
export function pluginSourceDir(appPath: string, name: string): string {
  return join(appPath, 'plugins', name)
}

/** profile 中插件应安装的位置。 */
function pluginTargetDir(dshHome: string, name: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', name)
}

/** 复制单个插件到 profile 并登记 bundle。返回是否成功。 */
function installOne(dshHome: string, appPath: string, name: string): boolean {
  const src = pluginSourceDir(appPath, name)
  if (!existsSync(join(src, 'index.js'))) {
    console.warn(`[dsh-desktop] 插件 ${name} 源码缺失，跳过`)
    return false
  }
  const target = pluginTargetDir(dshHome, name)
  try {
    mkdirSync(join(target, '..'), { recursive: true })
    cpSync(src, target, { recursive: true })
    // 标记为桌面端安装（清理时据此区分用户自装插件）
    writeFileSync(join(target, DESKTOP_MANAGED_MARKER), 'desktop-managed\n')
    const manifestPath = join(dshHome, 'profiles', 'web', 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const bundles = manifest?.dsh?.profile?.bundles ?? []
      if (!bundles.includes(name)) {
        bundles.push(name)
        manifest.dsh = { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), bundles } }
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      }
    }
    return true
  } catch (err) {
    console.error(`[dsh-desktop] 安装插件 ${name} 失败:`, err)
    return false
  }
}

/** 检查 profile 与插件状态。 */
export function checkProfile(dshHome: string, appPath: string): ProfileSetupResult {
  const profileDir = join(dshHome, 'profiles', 'web')
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { status: 'needs-priming' }
  }
  // 坏配置自愈：损坏的 package.json 隔离成 .broken-<ts> 后从模板重建。
  // 借鉴 dsh_desktop 的 profile-bundle-heal.js：坏 package.json 备份再重建，
  // 而不是让整个 boot 崩溃。
  healCorruptConfig(manifestPath, () => {
    // 重建：最小可启动的 profile package.json 骨架
    // bundles 必须含核心 in-box 层（base + web-app），再叠本地插件；
    // 只写插件会丢掉核心层，dsh 启动后功能缺失
    return JSON.stringify(
      {
        name: 'web-profile',
        version: '1.0.0',
        private: true,
        dsh: { profile: { bundles: [...CORE_PROFILE_BUNDLES, ...BUNDLE_PLUGINS] } },
      },
      null,
      2,
    ) + '\n'
  })

  let anyFail = false
  // 总是同步本地插件源码到 profile（保证改动即时生效，覆盖旧版本）
  for (const name of BUNDLE_PLUGINS) {
    if (!installOne(dshHome, appPath, name)) anyFail = true
  }

  // 清理清单已移除的旧插件安装（如旧版 harness-memory）：从 bundles 与
  // node_modules 一并移除，否则 dsh 仍会加载并在插件列表显示。幂等，每次启动
  // 都跑。仅处理裸包名，不动 @scope 的引擎/核心包。
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles ?? []
    const stale = diffStaleBundles(bundles, BUNDLE_PLUGINS)
    if (stale.length > 0) {
      manifest.dsh = {
        ...(manifest.dsh ?? {}),
        profile: { ...(manifest.dsh?.profile ?? {}), bundles: bundles.filter((n: string) => !stale.includes(n)) },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      for (const name of stale) {
        const target = pluginTargetDir(dshHome, name)
        // 只删桌面端安装的（带标记）；用户自装插件仅取消登记、保留源码。
        if (existsSync(join(target, DESKTOP_MANAGED_MARKER))) {
          rmSync(target, { recursive: true, force: true })
        }
      }
      console.log(`[dsh-desktop] 清理已移除的插件: ${stale.join(', ')}`)
    }
  } catch (err) {
    console.error('[dsh-desktop] 清理旧插件失败:', err)
  }

  return anyFail ? { status: 'skip', reason: '部分插件安装失败' } : { status: 'ready' }
}
