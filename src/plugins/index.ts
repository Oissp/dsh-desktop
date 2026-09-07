/**
 * UI 插件注册表（renderer 侧）。
 *
 * 声明式清单，风格对齐 electron/plugin-manifest.ts 的 COMPANION_PLUGINS：
 * 新增插件 = 加一条 import + 一条数组项，业务组件（SettingsModal / ChatView）
 * 只消费注册表，不感知单个插件实现。
 */
import type { UiPlugin } from './types'
import usagePlugin from './usage'
import workspacePlugin from './workspace'

/** 全部已注册 UI 插件（顺序即展示顺序）。 */
export const UI_PLUGINS: UiPlugin[] = [usagePlugin, workspacePlugin]

/** 有设置面板的插件（挂到设置导航最底部）。 */
export function settingsPlugins(): UiPlugin[] {
  return UI_PLUGINS.filter((p) => p.settings)
}

/** 有会话右侧面板的插件。 */
export function workspacePlugins(): UiPlugin[] {
  return UI_PLUGINS.filter((p) => p.workspacePanel)
}

export type { UiPlugin, PluginContext } from './types'
