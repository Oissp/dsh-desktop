/**
 * electron/ipc.ts —— IPC 注册：把 adapter 的稳定 API 暴露给 renderer。
 *
 * renderer 只认识这里的 channel 与 shared/types.ts 里的类型；
 * dsh 上游变更永远到不了这里。
 */
import { ipcMain, dialog, shell, nativeTheme, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { DshManager } from './dsh-manager.js'
import type { SettingsStore } from './settings-store.js'
import type { SafeCredentialStore } from './credential-store.js'
import { fetchWithTimeout, isAbortError } from '../shared/fetch-timeout.js'
import type { AppSettings, DshStatus, IpcResult } from '../shared/types.js'

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

function fail(error: unknown): IpcResult<never> {
  const err = error as { code?: string; message?: string }
  return {
    ok: false,
    error: { code: err.code ?? 'error', message: err.message ?? String(error) },
  }
}

function run<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  return fn().then(ok, fail)
}

export function registerIpc(
  manager: DshManager,
  settings: SettingsStore,
  getWindow: () => BrowserWindow | null,
  creds: SafeCredentialStore,
) {
  const adapter = () => {
    const a = manager.adapterInstance
    if (!a) throw new Error('dsh 引擎尚未就绪')
    return a
  }

  // ---- 应用状态 ----
  ipcMain.handle('app:getState', () => run(() => Promise.resolve(settings.get())))
  ipcMain.handle('app:updateSettings', (_e, patch: Partial<AppSettings>) =>
    run(() => Promise.resolve(settings.update(patch))),
  )

  // ---- 主题源（官方 UI 页面用） ----
  // preload 观察到 html[data-ds-theme-source] 变化时单向推送（无回执）。
  // 只接受白名单取值——该值决定整个应用的原生窗口装饰，不能让渲染进程写任意串。
  ipcMain.on('desktop:themeSource', (_e, source: unknown) => {
    if (source === 'light' || source === 'dark' || source === 'system') {
      nativeTheme.themeSource = source
    }
  })

  // ---- dsh 生命周期 ----
  ipcMain.handle('dsh:status', () => run(() => Promise.resolve(manager.status())))
  ipcMain.handle('dsh:ensure', () => run(() => manager.start()))
  // 手动重启内核（恢复页按钮；清除崩溃环后重新 boot）
  ipcMain.handle('dsh:restart', () => run(() => manager.restart()))
  ipcMain.handle('dsh:restoreCheckpoint', () => run(() => manager.restoreCheckpointAndRestart()))
  ipcMain.handle('dsh:openConfigDir', () =>
    run(async () => {
      // 打开 dsh profile 目录供用户检查配置（恢复页"打开配置目录"按钮）
      await shell.openPath(join(manager.home, 'profiles', 'web'))
    }),
  )

  // ---- 会话（向导创建） ----
  ipcMain.handle('session:create', (_e, cwd?: string, agentPreset?: string) =>
    run(() => adapter().createSession(cwd, agentPreset)),
  )

  // ---- 模型目录（向导展示默认模型） ----
  ipcMain.handle('model:list', () => run(() => adapter().listModels()))

  // ---- 凭据（向导首启配置 API Key） ----
  ipcMain.handle('cred:setKey', (_e, key: string) =>
    run(async () => {
      await adapter().setApiKey(key)
      creds.set('DEEPSEEK_API_KEY', key)
    }),
  )
  // 测试 DeepSeek API Key：主进程用 key 调 models 端点验证（key 不入 renderer 往返，不落日志）
  ipcMain.handle('cred:testKey', (_e, key: string) =>
    run(async () => {
      const apiKey = String(key ?? '').trim()
      if (!apiKey) throw new Error('请输入 API Key')
      // 加超时：网络挂起时不能让 IPC 永久阻塞、UI 无响应
      let res: Response
      try {
        res = await fetchWithTimeout(
          'https://api.deepseek.com/models',
          { headers: { authorization: `Bearer ${apiKey}` } },
          15_000,
        )
      } catch (err) {
        throw new Error(
          isAbortError(err) ? '验证超时（15s），请检查网络后重试' : `验证请求失败：${(err as Error).message}`,
        )
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Key 无效：HTTP ${res.status} ${body.slice(0, 120)}`)
      }
      const data = (await res.json().catch(() => ({}))) as { data?: unknown[] }
      const count = Array.isArray(data.data) ? data.data.length : 0
      return { ok: true, message: `Key 有效，可用模型 ${count} 个` }
    }),
  )
  ipcMain.handle('dir:pick', () =>
    run(async () => {
      // 优先走 dsh 的原生目录选择器；失败或取消时回退 Electron 对话框
      try {
        const a = adapter()
        const { path } = await a.pickDirectory()
        if (path) return path
      } catch {
        // 继续回退
      }
      const win = getWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        title: '选择工作区文件夹',
        properties: ['openDirectory', 'createDirectory'],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    }),
  )

  // ---- 状态推送（主进程 → renderer） ----
  const onStatus = (s: DshStatus) => {
    getWindow()?.webContents.send('dsh:status', s)
  }
  const unsubStatus = manager.onStatus(onStatus)

  // 预加载时调用，确保退出时清理
  return () => {
    unsubStatus()
  }
}
