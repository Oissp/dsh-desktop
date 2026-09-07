/**
 * UI 插件类型定义（renderer 侧插件注册表）。
 *
 * 与官方 Cordis 插件模型的关系（https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/）：
 * - 官方插件 = 导出 name+apply 的模块，经 cordis.yml/patch 加载，通过 ctx 注册能力，
 *   inject 声明服务依赖，卸载自动清理。那是「agent 能力层」的插件。
 * - 官方 UI（harness 内置 Web UI）本身不插件化；桌面壳渲染自己的 React UI，
 *   界面扩展只能自建机制。故本注册表对齐 Cordis 的「声明式 + inject 依赖注入 + 生命周期清理」思想。
 * - 能力层插件见 plugins/ + electron/plugin-manifest.ts（harness-memory 已是标准对象形式）。
 *
 * 设计参考：
 * - 主进程侧 companion 插件清单（electron/plugin-manifest.ts）的声明式风格：
 *   新增插件 = 在 src/plugins/index.ts 注册 + 放一个自包含目录，不改业务组件。
 * - 每个插件是一个自包含模块：manifest（id/name/description）+ 可选的
 *   settings 面板（挂到设置导航最底部）与 workspacePanel（挂到会话右侧）。
 *
 * 数据由宿主注入（PluginContext），插件不直接依赖 App 内部实现。
 */
import type { AppSettings } from '../../shared/types'

/** 宿主注入给插件的上下文。 */
export interface PluginContext {
  appSettings: AppSettings
  sessionId: string | null
  workspaceCwd: string | null
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<{ ok: boolean; error?: { message?: string } }>
}

/** 设置面板插件：在设置导航最底部追加一个分组项。 */
export interface SettingsPlugin {
  /** 导航 label（如「用量」）。 */
  navLabel: string
  /** 导航项底部描述（可选，用于说明该分组）。 */
  navHint?: string
  /**
   * 依赖注入声明（对齐 Cordis 的 `inject` 思想）：
   * 自述需要 PluginContext 里的哪些能力，宿主按其声明提供上下文。
   * 缺省 = 需要全部能力。
   */
  inject?: (keyof PluginContext)[]
  render: (ctx: PluginContext) => React.ReactNode
}

/** 会话右侧面板插件的上下文（ChatView 能提供的部分）。 */
export interface WorkspacePanelContext {
  sessionId: string | null
  workspaceCwd: string | null
}

/** 会话右侧面板插件：在聊天头部右侧加一个开关按钮。 */
export interface WorkspacePlugin {
  /** 开关按钮的 title / aria-label。 */
  title: string
  /** 开关按钮激活时的 title（可选，默认同 title）。 */
  titleActive?: string
  /** AI 写文件/创建文件类工具调用时自动打开面板（对齐 Alma 生成 artifact 自动展开）。 */
  autoOpenOnFileWrite?: boolean
  /** 依赖注入声明（对齐 Cordis `inject`）：自述需要 WorkspacePanelContext 里的哪些能力，缺省 = 全部。 */
  inject?: (keyof WorkspacePanelContext)[]
  render: (ctx: WorkspacePanelContext) => React.ReactNode
}

/** 一个 UI 插件。 */
export interface UiPlugin {
  id: string
  name: string
  description?: string
  settings?: SettingsPlugin
  workspacePanel?: WorkspacePlugin
}
