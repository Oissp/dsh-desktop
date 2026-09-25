/**
 * electron/plugin-manifest.ts —— 声明式伴随插件清单（单一来源）。
 *
 * 借鉴 dsh_desktop 的 COMPANION_PLUGINS 数组（dsh-desktop/scripts/lib/companion-plugins.js）：
 * 把"装哪些插件"从硬编码数组升级为声明式清单，每条目含元数据，
 * 新增/禁用插件只改清单不改安装逻辑。
 *
 * 清单是插件管理的唯一事实源——profile-setup.ts 读取它来决定安装哪些插件。
 * 每个条目：
 *  - id：插件名（与 plugins/<id>/ 目录名一致，也是 dsh bundle 名）
 *  - enabled：是否启用（默认 true；可按条件禁用，如 harness-pet 默认关）
 *  - fatal：安装失败是否致命（false = 静默降级，true = 阻断启动）
 */

/** 一个伴随插件的清单条目。 */
export interface CompanionPluginEntry {
  /** 插件 id（= 目录名 = dsh bundle 名）。 */
  id: string
  /** 是否启用（默认 true）。 */
  enabled?: boolean
  /** 安装失败是否致命（默认 false = 静默降级）。 */
  fatal?: boolean
  /** 人类可读说明（诊断用）。 */
  description?: string
}

/**
 * 伴随插件清单（单一来源）。
 *
 * 新增插件只需在此数组加一条目 + 在 plugins/<id>/ 放插件源码。
 * 移除清单或设 enabled: false 后，下一次启动 profile-setup 会从
 * dsh.profile.bundles 与 profile node_modules 一并清理该插件（不再加载，
 * 插件列表消失）；重新加入清单则自动重装（每次启动都重新同步源码）。
 */
export const COMPANION_PLUGINS: CompanionPluginEntry[] = [
  // 当前为空：唯一条目 dsh-desktop-archived 已移除。
  //
  // 移除原因——dsh 0.1.7-alpha.1 起引擎自带完整的归档会话体验，该插件成了重复实现：
  // 侧边栏「视图选项」提供三态筛选（隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档），
  // 归档行原地置灰渲染、带行菜单与悬浮操作、可取消归档并支持撤销，空态也有独立文案。
  // 插件那套「另起一个归档面板 + 侧边栏分组」靠 overflow:hidden 祖先做结构定位把
  // DOM portal 进工作区区域，随引擎 UI 改动持续失效，已无保留价值。
  //
  // 移除后失效的能力（上游没有对应实现）：
  //  - 归档会话只读查看器：引擎明确禁止打开归档行（aria-description
  //    「已归档对话暂时无法查看，请取消归档后查看」），只能先取消归档再查看。
  //  - 归档会话彻底删除：引擎没有删除 RPC（README：sessions can be archived but
  //    never deleted）。桌面端的 session:hardDelete 仍保留在 __desktop__ 桥上，但
  //    已无应用内调用方。
  //
  // 新增伴随插件在此添加，例如：
  // { id: 'harness-pet', enabled: false, description: '桌面宠物（默认关）' },
]

/**
 * 获取当前应安装的插件列表（已过滤 enabled: false 的）。
 */
export function activeCompanionPlugins(): CompanionPluginEntry[] {
  return COMPANION_PLUGINS.filter((p) => p.enabled !== false)
}
