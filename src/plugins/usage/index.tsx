/**
 * usage 插件：设置底部「用量」面板（参考 Alma 设置中的 Usage section）。
 */
import type { UiPlugin } from '../types'
import UsageSection from './UsageSection'

const usagePlugin: UiPlugin = {
  id: 'usage',
  name: '用量统计',
  description: '从会话事件流统计 token 用量与工具调用，按天聚合，本地保存。',
  settings: {
    navLabel: '用量',
    navHint: 'Token 用量与工具调用统计',
    // 依赖注入声明（对齐 Cordis inject）：只用得到这两项
    inject: ['appSettings', 'onUpdateSettings'],
    render: (ctx) => <UsageSection ctx={ctx} />,
  },
}

export default usagePlugin
