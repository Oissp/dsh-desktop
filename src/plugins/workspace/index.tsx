/**
 * workspace 插件：会话右侧「工作区」面板（参考 Alma 会话右侧的 Artifact 面板）。
 * 文件树 + 文件内容预览，数据由主进程 IPC 提供（受限于工作区根目录内）。
 */
import type { UiPlugin } from '../types'
import WorkspacePanel from './WorkspacePanel'

const workspacePlugin: UiPlugin = {
  id: 'workspace',
  name: '工作区面板',
  description: '在会话右侧展示工作区文件树与文件内容预览。',
  workspacePanel: {
    title: '工作区',
    titleActive: '收起工作区',
    /** AI 写文件/创建文件时自动打开（对齐 Alma：生成 artifact 自动展开）。 */
    autoOpenOnFileWrite: true,
    render: (ctx) => <WorkspacePanel workspaceCwd={ctx.workspaceCwd} />,
  },
}

export default workspacePlugin
