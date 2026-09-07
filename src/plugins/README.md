# UI 插件（renderer 侧）

本项目有两套"插件"概念，别混淆：

| 层 | 机制 | 位置 | 用途 |
|---|---|---|---|
| 伴随插件 | dsh agent bundle（记忆等 agent 能力） | `plugins/<id>/` + `electron/plugin-manifest.ts` | 扩展 agent 能力 |
| **UI 插件** | React 组件注册表（本目录） | `src/plugins/` + `src/plugins/index.ts` | 扩展界面（设置面板、右侧面板） |

## 已内置插件

| id | 名称 | 挂载点 | 说明 |
|---|---|---|---|
| `usage` | 用量统计 | 设置导航最底部「用量」 | 从会话事件流（`turn-end.usage` / `tool-call`）统计 token 与工具调用，按天聚合本地保存（最多 90 天）。字段对齐引擎 `TokenUsage`：输入/输出/**缓存读/缓存写/推理** token；面板含范围切换（今日/本周/本月/全部）+ 8 张指标卡 + 最近 7 天三段柱状条（缓存读/输入/输出） |
| `workspace` | 工作区面板 | 会话右上「工作区」按钮 | 工作区文件树 + 文件内容预览；AI 写文件时自动展开；左缘可拖拽调宽（300–560px）。列目录/读文件由主进程 IPC 提供（`desktop:listWorkspace` / `desktop:readWorkspaceFile`），受限于工作区根目录内，忽略常见构建产物目录 |

## 新增一个 UI 插件

1. 建目录 `src/plugins/<id>/`，实现 `UiPlugin`（见 `types.ts`）：

```ts
import type { UiPlugin } from '../types'

const myPlugin: UiPlugin = {
  id: 'my-plugin',
  name: '我的插件',
  description: '一句话说明',
  // 挂到设置底部（可选）
  settings: {
    navLabel: '我的面板',
    render: (ctx) => <MySection ctx={ctx} />,
  },
  // 挂到会话右侧（可选）
  workspacePanel: {
    title: '我的面板',
    // AI 写文件类工具调用时自动打开（可选）
    autoOpenOnFileWrite: true,
    render: (ctx) => <MyPanel workspaceCwd={ctx.workspaceCwd} />,
  },
}
export default myPlugin
```

2. 在 `src/plugins/index.ts` 注册：

```ts
import myPlugin from './my-plugin'
export const UI_PLUGINS: UiPlugin[] = [usagePlugin, workspacePlugin, myPlugin]
```

完事。`SettingsModal` / `ChatView` 只消费注册表，不需要改业务组件。

## 约定

- 插件数据持久化走 `AppSettings`（在主进程 `settings-store` 落地），类型加在 `shared/types.ts`。
- 需要新的桌面能力（文件、窗口、系统）时，在 `electron/ipc.ts` 注册 IPC channel，经 `electron/preload.ts` 的 `__desktop__` 桥暴露，并在 `src/types.d.ts` 声明类型。**主进程侧必须做路径/大小校验**（参考 `listWorkspaceTree` 的根目录限制）。
- 样式追加在 `src/styles.css`，类名以插件 id 为前缀（`usage-*` / `ws-*`），避免与业务样式冲突。
- 核心逻辑（如 `UsageStore`）写单测，放插件目录内，`vitest` 会自动拾取。

## 与官方文档的对齐情况（2026-09-07 核对）

对照官方文档做了逐项核对，结论如下：

| 官方文档要点 | 位置 | 我们的实现 | 状态 |
|---|---|---|---|
| 插件 = 导出 `name+apply(ctx)` 的模块（[basic](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)） | `plugins/harness-memory/index.js` | `export default { name, inject, Config, apply }`（对象形式） | ✅ 已对齐 |
| 配置经 schema 校验（[教程 05](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/05-config)） | `plugins/harness-memory/index.js` | `Config = z.object(...)`（**schemastery**，官方同款） | ✅ 已对齐 |
| patch/`cordis.yml` 声明加载（`- insert:` 语法） | `plugins/harness-memory/cordis.patch.yml` | 同款语法；安装走 profile `node_modules` + `dsh.profile.bundles` 登记 | ✅ 已对齐 |
| `inject` 声明服务依赖（[教程 03](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/03-services) / config-catalog 的 `Requires:` 行） | 能力层 `plugins/` / UI 层 `src/plugins/` | 能力层：`inject` 字段；UI 层：`UiPlugin.settings.inject` / `workspacePanel.inject` | ✅ 已对齐 |
| 生命周期自动清理（[教程 02](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/02-lifecycle-and-effects)） | 能力层：`ctx` 自动清理；UI 层：React `useEffect` 卸载清理 + `attach()` 返回 unsub | 两侧均无需手动 removeListener | ✅ 已对齐 |
| 每个包的 `config:` 块可由配置声明（[config-catalog](https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog)） | `cordis.patch.yml` 的 `config: { maxMemories, sectionOrder }` | 能力层插件已配置化 | ✅ 已对齐 |
| UI 层官方**没有**插件机制（内置 Web UI 不插件化） | 桌面壳渲染自研 React UI | `src/plugins/` 自建注册表（对齐 Cordis 的声明式 + inject 思想） | ℹ️ 无官方对应物 |

### 几个值得知道的官方配置（config-catalog）

- **TokenUsage 字段**：引擎 `dsh-llm` 定义完整 `TokenUsage`（input/output/cacheRead/cacheWrite/reasoning/total），
  经 `turn/end` 事件的 `usage` 字段下传；adapter 已全字段透传，usage 插件按此聚合。
  `inputTokens` 为未缓存输入，计费输入 = input + cacheRead + cacheWrite。
- **agent-instructions**：工作区 `AGENTS.md` 指令加载是引擎内置能力
  （`dshHome` / `projectRootMarkers` / `instructionFileCandidates` 可配置），
  桌面壳无需自己实现；workspace 面板只负责展示文件树。
- **fs-local**：引擎有工作区文件索引（含索引上限配置）；workspace 面板目前直接用
  主进程 `readdir`（路径受限 + 忽略列表），不依赖引擎索引，两侧互不干扰。

### 新插件核对清单

新增插件时对照上面的表格自查：能力层用官方对象形式 + schemastery Config；
UI 层补 `inject` 声明 + 生命周期清理；避免"官方已内置"的功能重复实现。
