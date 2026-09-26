/**
 * electron/main.ts —— 应用入口。
 */
import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, dialog, type MenuItemConstructorOptions } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DshManager, SHUTDOWN_GRACE_MS, KILL_TIMEOUT_MS } from './dsh-manager.js'
import { SettingsStore } from './settings-store.js'
import { registerIpc } from './ipc.js'
import { createCredentialStore, userDataDir } from './credential-store.js'
import { LogFileSink } from './log-sink.js'
import { FileLogger, setLogger, installUncaughtExceptionCapture, installChildProcessGoneLogging, formatExitCode, type DesktopLogger } from './desktop-logger.js'
import { writeCrashReport, type CrashReportFacts, type CrashSource } from './crash-report.js'
import { redactSecrets } from './secret-redaction.js'
import { QuitConfirmation, inspectQuitState } from './quit-confirmation.js'
import { UpdateLifecycle } from './update-lifecycle.js'
import { MainWindowGeneration } from './window-generation.js'
import updaterModule from 'electron-updater'
// electron-updater 是 CJS；ESM 下具名导出互操作不可靠，取 default 对象的 autoUpdater
const { autoUpdater } = updaterModule as { autoUpdater: typeof import('electron-updater')['autoUpdater'] }

const __dirname = dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const LOG_DIR = join(app.getPath('userData'), 'logs')

// 日志器：app ready 前用 ConsoleLogger 兜底（uncaughtException 已可落盘需先有 sink）。
// 尽早在模块加载时建 sink，确保崩溃现场不丢。
const logSink = new LogFileSink(LOG_DIR)
const logger: DesktopLogger = new FileLogger(logSink)
setLogger(logger)
// 第一个未捕获异常：落盘 + 写崩溃报告后致命退出（必须在任何异步工作前注册）
installUncaughtExceptionCapture((code, error) => {
  void reportCrash('main', 'main-uncaught', error).finally(() => {
    app.exit(code)
  })
})

// ---- 崩溃报告（electron/crash-report.ts）----

/** 渲染进程控制台环形缓冲：崩溃报告里最有用的一段现场，按字节上限只留尾部。 */
const rendererConsole: string[] = []
let rendererConsoleBytes = 0
const RENDERER_CONSOLE_MAX_BYTES = 64 * 1024
/** 当前窗口的诊断监听卸载函数（重建窗口时先卸旧的，避免重复记录）。 */
let detachRendererDiagnostics: () => void = () => {}

function pushRendererConsole(line: string): void {
  // 先脱敏再入缓冲：官方 UI 的控制台错误里常见失败的 `Authorization` 头与带 token
  // 的 URL，而这段缓冲会原样进崩溃报告（用户会把它贴进公开 issue）
  const redacted = redactSecrets(line)
  rendererConsole.push(redacted)
  rendererConsoleBytes += Buffer.byteLength(redacted, 'utf8') + 1
  while (rendererConsoleBytes > RENDERER_CONSOLE_MAX_BYTES && rendererConsole.length > 1) {
    const dropped = rendererConsole.shift()
    if (dropped !== undefined) rendererConsoleBytes -= Buffer.byteLength(dropped, 'utf8') + 1
  }
}

function crashFacts(): CrashReportFacts {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? '未知',
    chrome: process.versions.chrome ?? '未知',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  }
}

/** 引擎状态快照，作为崩溃报告的诊断段。manager 在 ready 前未初始化。 */
function engineDiagnostics(): string {
  if (!manager) return '（引擎管理器尚未初始化）'
  const s = manager.status()
  return [
    `引擎运行: ${s.running ? '是' : '否'}`,
    `引擎就绪: ${s.ready ? '是' : '否'}`,
    `引擎端口: ${s.port ?? '—'}`,
    `引擎版本: ${s.version ?? '—'}`,
    `恢复态: ${s.recovery ? '是' : '否'}`,
    `最近错误: ${s.error ?? '—'}`,
    `工作目录: ${s.cwd ?? '—'}`,
    `DSH_HOME: ${manager.home}`,
    `日志目录: ${LOG_DIR}`,
  ].join('\n')
}

/**
 * 写一份崩溃报告并返回其路径（失败返回 null）。
 * 额外诊断段由调用方给，未给则默认落引擎状态——三类崩溃现场里它都是关键上下文。
 */
async function reportCrash(
  source: CrashSource,
  phase: string,
  error?: unknown,
  diagnostics?: string,
): Promise<string | null> {
  const path = await writeCrashReport(LOG_DIR, {
    time: new Date(),
    source,
    phase,
    facts: crashFacts(),
    error,
    diagnostics: diagnostics ?? engineDiagnostics(),
    consoleTail: rendererConsole,
  })
  if (path) logger.error(`[crash] ${source} 崩溃报告已写入 ${path}`)
  else logger.warn(`[crash] ${source} 崩溃报告写入失败（${phase}）`)
  return path
}

let mainWindow: BrowserWindow | null = null
let windowGen: MainWindowGeneration | null = null
let tray: Tray | null = null
let manager: DshManager
let settings: SettingsStore
let disposeIpc: () => void = () => {}
let quitting = false
let trayHintShown = false

// ---- 自动更新 ----
// 注意：macOS 自动更新依赖代码签名（017）；未签名时自动更新被禁用，静默跳过。
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
// 仅稳定渠道：历史上为 0.1.x 预发布版用户跨通道升级设过 allowPrerelease+channel
// 的 hack，但公开发行的桌面包全是稳定 1.0.x（无 rc/alpha 用户），已移除。

// 更新生命周期实例（app.whenReady 中创建）。单飞检查、安装前 recheck、
// 按版本去重后台提示，见 electron/update-lifecycle.ts。
let updateLifecycle: UpdateLifecycle | null = null

// ---- 退出确认（electron/quit-confirmation.ts）----
// 判定"有没有任务在跑"：引擎未起来时无从谈起（没会话就不可能跑），直接放行。
const quitConfirmation = new QuitConfirmation({
  inspect: async () => {
    const adapter = manager?.adapterInstance
    if (!adapter) return { kind: 'idle', activeSessions: 0 }
    return inspectQuitState(() => adapter.listSessions())
  },
  // 不带 owner window：窗口可能已隐藏到托盘（macOS 挂到隐藏窗口上的框不会显示），
  // 且在关闭到托盘的模型里"退出"常常发生在窗口不可见时。
  show: (options) => dialog.showMessageBox(options),
})

/** 显示/恢复主窗口（无窗口则新建）。托盘菜单与单击共用。 */
function showWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

/** 应用已下载的更新并重启。委托给 UpdateLifecycle（安装前 recheck + 退出生命周期）。 */
function applyDownloadedUpdate() {
  updateLifecycle?.applyDownloadedUpdate()
}

/** 构建托盘右键菜单：更新已下载时"检查更新"切为"应用更新"。 */
function buildTrayMenu(): Menu {
  const readyVersion = updateLifecycle?.readyVersion ?? null
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    readyVersion
      ? { label: `应用更新 v${readyVersion}`, click: applyDownloadedUpdate }
      : { label: '检查更新', click: () => updateLifecycle?.checkNow() },
    { type: 'separator' },
    { label: '退出', click: () => requestQuit() },
  ])
}

/** 重建托盘菜单（更新状态变化后切换"检查更新"/"应用更新"）。 */
function rebuildTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu())
}

/** 创建系统托盘：鲸鱼图标 + 菜单（显示/新建会话/检查更新/退出）。 */
function createTray() {
  const isMac = process.platform === 'darwin'
  const trayDir = join(app.getAppPath(), 'build', 'tray')
  const image = nativeImage.createFromPath(join(trayDir, 'TrayTemplate.png'))
  if (image.isEmpty()) {
    // 兜底：用应用图标（彩色，非 template）
    tray = new Tray(join(app.getAppPath(), 'build', 'icon.png'))
  } else if (isMac) {
    // macOS：template image 由系统自动适配菜单栏深浅色（深色栏→白，浅色栏→黑）
    image.setTemplateImage(true)
    tray = new Tray(image)
  } else {
    // Windows/Linux：任务栏不会自动反色，使用白色单色图标适配深色任务栏
    const whiteImage = nativeImage.createFromPath(join(trayDir, 'TrayWhite.png'))
    if (whiteImage.isEmpty()) {
      // 白色图标缺失时回退到 template（黑色）
      image.setTemplateImage(true)
      tray = new Tray(image)
    } else {
      tray = new Tray(whiteImage)
    }
  }
  tray.setToolTip('DSH Desktop')
  // 菜单通过 rebuildTrayMenu 设置：若启动时已有待安装更新（极少见）也能正确展示
  rebuildTrayMenu()
  // 单击托盘图标 → 显示主窗口
  tray.on('click', showWindow)
  return tray
}

// ---- 单实例锁（012）：防止双开导致 dsh 引擎抢随机端口/资源冲突 ----
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

/**
 * 挂上渲染进程诊断：控制台尾部进环形缓冲，进程消失时落一份崩溃报告。
 * 返回卸载函数——重建窗口时旧的 webContents 已死，但其监听器仍持有缓冲引用。
 */
function attachRendererDiagnostics(win: BrowserWindow): () => void {
  const wc = win.webContents
  const onConsole = (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>): void => {
    // 只留 warning/error：官方 Web UI 的 info/debug 量极大，会把真正的崩溃前兆冲出缓冲
    if (details.level !== 'warning' && details.level !== 'error') return
    pushRendererConsole(`[${details.level}] ${details.message} (${details.sourceId}:${String(details.lineNumber)})`)
  }
  const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
    void reportCrash(
      'renderer',
      'renderer-gone',
      undefined,
      `渲染进程退出: reason=${details.reason} exitCode=${formatExitCode(details.exitCode)}`,
    )
  }
  const onUnresponsive = (): void => {
    pushRendererConsole('[main] 渲染进程无响应（unresponsive）')
  }
  wc.on('console-message', onConsole)
  wc.on('render-process-gone', onGone)
  wc.on('unresponsive', onUnresponsive)
  return () => {
    wc.off('console-message', onConsole)
    wc.off('render-process-gone', onGone)
    wc.off('unresponsive', onUnresponsive)
  }
}

/**
 * 创建主窗口 Shell generation。窗口、导航防护、引擎端口跟踪由 MainWindowGeneration
 * 完整拥有；引擎崩溃重启换端口时调 windowGen.loadEngineUI / loadFallback 即可，
 * 状态自洽、无遗留监听器（借鉴 anywhere-labs/dsh-desktop ElectronShellGeneration）。
 */
function createWindow() {
  detachRendererDiagnostics()
  windowGen = new MainWindowGeneration({
    preloadPath: join(__dirname, 'preload.js'),
    appPath: app.getAppPath(),
    devServerUrl: VITE_DEV_SERVER_URL,
    onHideToTray: () => {
      // 首次隐藏到托盘：提示一次（不打扰）
      if (!trayHintShown) {
        trayHintShown = true
        try {
          new Notification({ title: 'DSH Desktop', body: '应用已最小化到托盘，点托盘鲸鱼图标恢复。' }).show()
        } catch {
          // 通知失败不阻塞
        }
      }
    },
  })
  mainWindow = windowGen.window
  detachRendererDiagnostics = attachRendererDiagnostics(mainWindow)
}

/**
 * 移除应用顶部菜单栏：构建后窗口顶部不再显示「文件/编辑/视图」等菜单。 */
function setupMenu() {
  // macOS 用系统菜单栏（屏幕顶部，不侵入窗口 UI）：这是 macOS 用户找"检查更新"
  // 的惯例位置。同时提供编辑菜单——没有 Edit 菜单时 Cmd+C/V/X/A 等快捷键在
  // 官方 Web UI 的输入框里会失效。
  // Windows/Linux 保持无菜单栏（窗口内只有官方 Web UI），更新入口走托盘菜单。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const readyVersion = updateLifecycle?.readyVersion ?? null
  // 视图菜单：重载/开发者工具只在开发模式暴露。生产菜单里开 DevTools 可让
  // 任何人在官方 UI 里经 preload 桥访问 window.__desktop__ 的会话凭证。
  const viewSubmenu: MenuItemConstructorOptions[] = []
  if (!app.isPackaged) {
    viewSubmenu.push(
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
    )
  }
  viewSubmenu.push(
    { role: 'resetZoom', label: '实际大小' },
    { role: 'zoomIn', label: '放大' },
    { role: 'zoomOut', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '切换全屏' },
  )
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'DSH Desktop',
        submenu: [
          { role: 'about', label: '关于 DSH Desktop' },
          readyVersion
            ? { label: `应用更新 v${readyVersion}`, click: applyDownloadedUpdate }
            : { label: '检查更新', click: () => updateLifecycle?.checkNow() },
          { type: 'separator' },
          { role: 'hide', label: '隐藏 DSH Desktop' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: '退出 DSH Desktop' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '拷贝' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: viewSubmenu,
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'close', label: '关闭窗口' },
          { type: 'separator' },
          { role: 'front', label: '前置全部窗口' },
        ],
      },
    ]),
  )
}

/** 更新状态变化（已下载待安装）时重建应用菜单：菜单里"检查更新"→"应用更新"。 */
function rebuildAppMenu() {
  setupMenu()
}

/**
 * 退出入口。
 *
 * @param confirm 是否先问一句"有任务在跑，确定退出吗"。
 *   - true：用户主动退出（托盘菜单 / 应用菜单 / 关掉最后一个窗口）
 *   - false：系统信号（SIGTERM/SIGINT）与更新安装——前者是 OS 在催我们走，此时弹框
 *     会卡住注销/关机流程且未必有可用显示；后者用户刚点过"应用更新"，已经确认过。
 */
async function quitApp(confirm: boolean): Promise<void> {
  if (quitting) return
  if (confirm) {
    const ok = await quitConfirmation.confirm()
    // 等待期间可能已有别的路径（信号 / 更新）启动了退出，此时无条件让位
    if (!ok || quitting) return
  } else {
    // 绕过询问的路径：把决定做完了，关掉确认器，免得打开着的框被误读成"还能取消"
    quitConfirmation.dispose()
  }
  quitting = true
  windowGen?.markQuitting()
  if (tray) {
    tray.destroy()
    tray = null
  }
  const running = manager && manager.status().running
  const finish = () => {
    disposeIpc()
    if (updateLifecycle?.isQuitPending) {
      // 更新驱动退出：doInstall 已调 app.relaunch()。app.exit 跳过 before-quit/will-quit
      // 生命周期，部分 Electron 版本不会触发 relaunch，导致安装后应用不重启。此处改走
      // app.quit() 完成完整退出流程以 honoring relaunch。quitting 已置 true，before-quit
      // 处理器不会再拦截。
      app.quit()
    } else {
      app.exit(0)
    }
  }
  if (running) {
    // 兜底超时：必须长于 stop() 的升级阶梯（SIGTERM 宽限 + SIGKILL 上限），否则
    // 这里会先 app.exit(0)，把还在阶梯中的引擎变成孤儿——正是阶梯要避免的情况。
    // 阶梯正常时（引擎 1s 内退出）这个计时器根本不会触发。
    const timer = setTimeout(() => finish(), SHUTDOWN_GRACE_MS + KILL_TIMEOUT_MS + 1_000)
    manager
      .stop()
      .then((graceful) => {
        if (!graceful) logger.warn('[shutdown] 引擎未响应 SIGTERM，已 SIGKILL 强制终止')
      })
      .catch((err) => {
        logger.error(`[shutdown] 停止引擎失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        clearTimeout(timer)
        finish()
      })
  } else {
    finish()
  }
}

/** 需要先确认的用户主动退出（托盘菜单、应用菜单、关闭最后一个窗口）。 */
function requestQuit(): void {
  void quitApp(true)
}

app.whenReady().then(async () => {
  if (!gotLock) return
  settings = new SettingsStore()
  manager = new DshManager()

  // safeStorage 加密凭证层：桌面端自有的敏感值加密存储
  const creds = createCredentialStore(userDataDir())

  setupMenu()
  // Linux 的 app_id / WM_CLASS 来自 package.json 的 `desktopName`
  // （= dsh-desktop.desktop，Electron 启动时即读取），**不能**在这里调
  // app.setDesktopName —— 该 API 文档要求"必须在 ready 事件之前调用"，放到
  // whenReady 里已经太晚。原先这里就是这么写的，之所以一直看着没问题，是因为
  // Electron 在 desktopName 缺失时会回退成应用名的小写连字符 slug，
  // 恰好也是 dsh-desktop.desktop。现在值显式写在 package.json 里，构建侧
  // （electron-builder 的 linux.syncDesktopName）据此派生 .desktop 文件名与
  // StartupWMClass，三处标识（app_id / StartupWMClass / 文件名）由此对齐。
  // 见 electron-builder.yml 的 syncDesktopName 注释与 scripts/verify-deb.mjs 的断言。
  // utility/GPU 等子进程异常退出落盘
  installChildProcessGoneLogging(app)
  logger.info(`[boot] DSH Desktop 启动，版本 ${app.getVersion()}，日志目录 ${LOG_DIR}`)
  // 更新生命周期：单飞检查 + 安装前 recheck + 按版本去重后台提示
  updateLifecycle = new UpdateLifecycle(autoUpdater, logger, {
    getWindow: () => mainWindow,
    rebuildTrayMenu,
    rebuildAppMenu,
    // 更新安装完成后的退出：用户已经点过"应用更新"，不再弹退出确认
    requestQuit: () => void quitApp(false),
    markUpdateQuitting: () => {
      // 更新驱动的退出：置 quitting 让 before-quit 不拦截、窗口 close 处理器放行
      quitting = true
      windowGen?.markQuitting()
    },
  })
  updateLifecycle.start()
  disposeIpc = registerIpc(manager, settings, () => mainWindow, creds)

  createWindow()
  createTray()

  // 后台启动 dsh，就绪后加载官方 UI（引擎端口），失败不阻塞（保留回退屏）
  void manager.start().then((s) => {
    if (s.port) windowGen?.loadEngineUI(s.port, manager.token)
  }).catch((err) => {
    logger.error(`[dsh] 启动失败: ${err instanceof Error ? err.stack ?? err.message : err}`)
  })

  // 端口跟随：引擎崩溃重启换端口 → 窗口重新 loadURL 新端口（A0 端口漂移）
  let recoveryReported = false
  manager.onStatus((s) => {
    if (s.port && s.ready) windowGen?.loadEngineUI(s.port, manager.token)
    // 崩溃恢复态：引擎已死，窗口回退到本地 React UI（展示恢复页）
    if (s.recovery && !s.ready) {
      windowGen?.loadFallback()
      // 崩溃环熔断只触发一次：落一份引擎崩溃报告，并把路径回填到恢复页可见的
      // lastError —— 报告写了但用户找不到，等于没写。
      if (!recoveryReported) {
        recoveryReported = true
        void reportCrash('engine', 'engine-crash-loop').then((path) => {
          if (path) manager.annotateError(`崩溃报告：${path}`)
        })
      }
    } else if (!s.recovery) {
      // 脱离恢复态（恢复成功或用户点了"重启内核"）→ 允许下一次熔断再写一份报告
      recoveryReported = false
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', (e) => {
  if (!quitting && manager && manager.status().running) {
    e.preventDefault()
    requestQuit()
  }
})

// 关闭到托盘后没有窗口也不退出（托盘菜单"退出"才真正退出）
app.on('window-all-closed', () => {
  // 有托盘：保持后台运行（任何平台）
  if (tray) return
  // 无托盘（如开发早期）：非 macOS 退出，macOS 保持（符合惯例）
  if (process.platform !== 'darwin') requestQuit()
})

// SIGTERM / SIGINT（进程被外部终止）也要清理 dsh 子进程。
// 不弹退出确认：信号通常来自注销/关机/服务编排，卡在这里会拖住整个登出流程，
// 且此时未必还有可用显示。
process.on('SIGTERM', () => void quitApp(false))
process.on('SIGINT', () => void quitApp(false))

// 兜底：应用退出时确保子进程被终止
app.on('will-quit', () => {
  manager?.stop().catch(() => undefined)
})
