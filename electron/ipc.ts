/**
 * electron/ipc.ts —— IPC 注册：把 adapter 的稳定 API 暴露给 renderer。
 *
 * renderer 只认识这里的 channel 与 shared/types.ts 里的类型；
 * dsh 上游变更永远到不了这里。
 */
import { ipcMain, dialog, app, shell, Notification, type BrowserWindow } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DshManager } from './dsh-manager.js'
import type { SettingsStore } from './settings-store.js'
import type { SafeCredentialStore } from './credential-store.js'
import { fetchWithTimeout, isAbortError } from '../shared/fetch-timeout.js'
import type { AppSettings, DshStatus, IpcResult } from '../shared/types.js'
import { foldTitleSnapshot } from './title-snapshot.js'

/** 与 dsh 相同的会话日志路径编码（用于硬删定位，见 dsh-session-persistence-jsonl）。 */
function encodeSegment(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

function projectKey(cwd: string): string {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

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

  // ---- __desktop__ 桥（官方 UI 页面用） ----
  ipcMain.handle('desktop:getPort', () =>
    run(() => Promise.resolve(manager.adapterInstance?.client.port ?? null)),
  )
  ipcMain.handle('desktop:getVersion', () =>
    run(() => Promise.resolve(app.getVersion())),
  )
  ipcMain.handle('desktop:notify', (_e, title: string, body: string) =>
    run(async () => {
      try {
        new Notification({ title: String(title ?? ''), body: String(body ?? '') }).show()
      } catch {
        // 通知失败不阻塞
      }
    }),
  )

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

  // ---- 会话（向导创建 / 归档桥只读与删除） ----
  ipcMain.handle('session:create', (_e, cwd?: string, agentPreset?: string) =>
    run(() => adapter().createSession(cwd, agentPreset)),
  )
  ipcMain.handle('session:listArchived', () =>
    run(async () => {
      const list = await adapter().listArchivedSessions()
      // 合并本地元数据（标题/归档时间）：adapter 只返回引擎的归档 ID 列表，
      // 标题等桌面端缓存的额外信息需从 app-settings.json 读取后合并。
      // 标题优先取持久 meta（归档时写入，无 TTL），再退回活跃会话标题快照。
      // 硬删过的 id 在墓碑集合里，过滤掉引擎的幽灵行。
      const state = settings.get()
      const meta = state.archivedSessionMeta ?? {}
      const snapshot = state.sessionTitleSnapshot ?? {}
      const purged = new Set(state.purgedSessionIds ?? [])
      return list
        .filter((item) => !purged.has(item.sessionId))
        .map((item) => {
          const cached = meta[item.sessionId]
          return {
            ...item,
            title: cached?.title ?? snapshot[item.sessionId]?.title,
            archivedAt: cached?.archivedAt,
          }
        })
    }),
  )
  ipcMain.handle('session:history', (_e, sessionId: string) => run(() => adapter().getHistory(sessionId)))

  // 硬删除：先归档（dsh 原生：立即从活跃列表移除，session.list 不再返回），
  // 再取消运行中的 turn，最后尽力删除会话日志文件（数据清除）。
  // 之所以要先归档：dsh 的 session 存储持有内存注册表，仅外部删文件后
  // session.list 仍会返回该会话（看起来像删除无反应）。
  ipcMain.handle('session:hardDelete', (_e, sessionId: string, cwd?: string) =>
    run(async () => {
      try {
        await adapter().archiveSession(sessionId)
      } catch {
        // 归档失败不阻塞删除（尽力而为）
      }
      try {
        await adapter().cancelTurn(sessionId)
      } catch {
        // 忽略：未运行或已结束
      }
      try {
        const sessionsRoot = join(manager.home, 'sessions')
        const projectDir = cwd ? join(sessionsRoot, projectKey(cwd)) : join(sessionsRoot, '_no-cwd')
        const sessionDir = join(projectDir, encodeSegment(sessionId))
        if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true })
      } catch {
        // 文件清理失败不阻塞：会话已归档（从列表消失），数据可能残留但不可见
      }
      // dsh 无删除/取消归档 RPC，workspace 归档集合只增不减：硬删后 id 仍留在
      // archivedSessionIds，刷新会重现幽灵行（文件已删、cwd 映射消失后更删不掉）。
      // 记墓碑，listArchived 过滤掉。
      const purged = new Set(settings.get().purgedSessionIds ?? [])
      if (!purged.has(sessionId)) {
        purged.add(sessionId)
        settings.update({ purgedSessionIds: [...purged] })
      }
    }),
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

  // ---- 会话标题快照（归档列表标题兜底，P2 方案 A） ----
  // dsh 归档 baseline 只给 sessionId + cwd，标题归档后无处可查；这里周期性
  // 快照活跃会话标题，归档后列表仍能显示标题（TTL 内保留已归档条目）。
  // 会话从活跃列表消失（= 被归档）时顺带写持久 meta（标题 + 归档时间），
  // 归档列表的标题/时间不再受 7 天 TTL 限制。
  const TITLE_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const TITLE_SNAPSHOT_INTERVAL_MS = 60 * 1000
  const TITLE_SNAPSHOT_HEARTBEAT_MS = 5 * 60 * 1000
  let engineReadySeen = false
  let titleSnapshotLastWrite = 0

  /** 快照内容是否变化（忽略 at 刷新）：id 集合或标题变了才算。 */
  function titleSnapshotChanged(
    a: Record<string, { title: string; at: number }>,
    b: Record<string, { title: string; at: number }>,
  ): boolean {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return true
    for (const k of ka) {
      if (!b[k] || a[k].title !== b[k].title) return true
    }
    return false
  }

  const takeTitleSnapshot = async () => {
    const a = manager.adapterInstance
    if (!a) return
    try {
      const sessions = await a.listSessions()
      const now = Date.now()
      const state = settings.get()
      const prevSnapshot = state.sessionTitleSnapshot ?? {}
      const nextSnapshot = foldTitleSnapshot(prevSnapshot, sessions, now, TITLE_SNAPSHOT_TTL_MS)
      const patch: Partial<AppSettings> = {}

      // 活跃→消失的会话视为归档：写持久 meta（标题 + 归档时间）。已墓碑的
      // （硬删）不记，避免污染归档元数据。
      const activeIds = new Set(sessions.map((s) => s.sessionId))
      const purged = new Set(state.purgedSessionIds ?? [])
      const prevMeta = state.archivedSessionMeta ?? {}
      const nextMeta = { ...prevMeta }
      for (const [id, v] of Object.entries(prevSnapshot)) {
        if (!activeIds.has(id) && !(id in nextMeta) && !purged.has(id)) {
          nextMeta[id] = { title: v.title, archivedAt: now }
        }
      }
      if (Object.keys(nextMeta).length !== Object.keys(prevMeta).length) patch.archivedSessionMeta = nextMeta

      // 快照落盘：内容变化或本批有 meta 写入时立即写；仅 at 刷新每 5 分钟
      // 兜底一次（活跃会话 at 要新鲜，保证归档时 TTL 从归档时刻起算），
      // 避免每 60s 无条件全量写 app-settings.json。
      const changed = titleSnapshotChanged(prevSnapshot, nextSnapshot)
      if (changed || 'archivedSessionMeta' in patch || now - titleSnapshotLastWrite >= TITLE_SNAPSHOT_HEARTBEAT_MS) {
        patch.sessionTitleSnapshot = nextSnapshot
        titleSnapshotLastWrite = now
      }
      if (Object.keys(patch).length > 0) settings.update(patch)
    } catch {
      // 引擎瞬时不可用：跳过本次快照，下轮再试
    }
  }
  const titleSnapshotTimer = setInterval(() => void takeTitleSnapshot(), TITLE_SNAPSHOT_INTERVAL_MS)
  void takeTitleSnapshot()

  // ---- 状态推送（主进程 → renderer） ----
  const onStatus = (s: DshStatus) => {
    // 引擎就绪转换时立即快照一次，覆盖"启动即归档"的首个会话
    if (s.ready && !engineReadySeen) {
      engineReadySeen = true
      void takeTitleSnapshot()
    }
    getWindow()?.webContents.send('dsh:status', s)
  }
  const unsubStatus = manager.onStatus(onStatus)

  // 预加载时调用，确保退出时清理
  return () => {
    manager.adapterInstance?.close()
    clearInterval(titleSnapshotTimer)
    unsubStatus()
  }
}
