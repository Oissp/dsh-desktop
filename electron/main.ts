/**
 * electron/main.ts —— 应用入口。
 */
import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DshManager } from './dsh-manager.js'
import { SettingsStore } from './settings-store.js'
import { registerIpc } from './ipc.js'
import { createCredentialStore, userDataDir } from './credential-store.js'
import { LogFileSink } from './log-sink.js'
import { FileLogger, setLogger, installUncaughtExceptionCapture, installChildProcessGoneLogging, type DesktopLogger } from './desktop-logger.js'
import { UpdateLifecycle } from './update-lifecycle.js'
import { MainWindowGeneration } from './window-generation.js'
import updaterModule from 'electron-updater'
// electron-updater 是 CJS；ESM 下具名导出互操作不可靠，取 default 对象的 autoUpdater
const { autoUpdater } = updaterModule as { autoUpdater: typeof import('electron-updater')['autoUpdater'] }

const __dirname = dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// 日志器：app ready 前用 ConsoleLogger 兜底（uncaughtException 已可落盘需先有 sink）。
// 尽早在模块加载时建 sink，确保崩溃现场不丢。
const logSink = new LogFileSink(join(app.getPath('userData'), 'logs'))
const logger: DesktopLogger = new FileLogger(logSink)
setLogger(logger)
// 第一个未捕获异常：落盘后致命退出（必须在任何异步工作前注册）
installUncaughtExceptionCapture((code) => app.exit(code))

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
// electron-updater 按 semver 预发布标识符划分更新通道：0.1.1-rc.2 属 "rc" 通道，
// 1.0.0 属稳定通道。本仓库自 1.0.0 起用应用自身版本号（与 dsh 引擎版本解耦），
// 但仍有 0.1.x 预发布版用户需要跨通道升级到稳定版。固定 allowPrerelease=true 并把
// 检查通道设为 "alpha"（落入 alpha/beta 特殊集合 → shouldFetchVersion=true），可使
// 预发布版用户匹配到稳定版 release（hrefChannel=null 也命中）；稳定版用户同样能
// 发现新稳定版。待所有用户迁移到 1.0.0+ 后可移除这两行，回归默认的 /releases/latest 路径。
autoUpdater.allowPrerelease = true
autoUpdater.channel = 'alpha'

// 更新生命周期实例（app.whenReady 中创建）。单飞检查、安装前 recheck、
// 按版本去重后台提示，见 electron/update-lifecycle.ts。
let updateLifecycle: UpdateLifecycle | null = null

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
    {
      label: '新建会话',
      click: () => {
        showWindow()
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) win.webContents.send('menu:new-chat')
      },
    },
    readyVersion
      ? { label: `应用更新 v${readyVersion}`, click: applyDownloadedUpdate }
      : { label: '检查更新', click: () => updateLifecycle?.checkNow() },
    { type: 'separator' },
    { label: '退出', click: () => shutdown() },
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
 * 创建主窗口 Shell generation。窗口、导航防护、引擎端口跟踪由 MainWindowGeneration
 * 完整拥有；引擎崩溃重启换端口时调 windowGen.loadEngineUI / loadFallback 即可，
 * 状态自洽、无遗留监听器（借鉴 anywhere-labs/dsh-desktop ElectronShellGeneration）。
 */
function createWindow() {
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

/** 优雅退出：先停掉 dsh 子进程，再退出应用。 */
function shutdown() {
  if (quitting) return
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
    // 最多等 6s，超时强制退出
    const timer = setTimeout(() => finish(), 6000)
    manager
      .stop()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer)
        finish()
      })
  } else {
    finish()
  }
}

app.whenReady().then(async () => {
  if (!gotLock) return
  settings = new SettingsStore()
  manager = new DshManager()

  // safeStorage 加密凭证层：桌面端自有的敏感值加密存储
  const creds = createCredentialStore(userDataDir())

  // 开机自启（若配置过）——开机自动拉起，保证 dsh 引擎随系统启动。
  // Electron 44 移除了 setLoginItemSettings 的 openAsHidden（仅 macOS ≤12 有效，
  // 44 起不再支持 macOS 12）；"启动最小化"由下方 whenReady 的应用内逻辑实现。
  const appearance = settings.get().appearance
  if (appearance?.autoLaunch) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  setupMenu()
  // Wayland 下 Electron 会自行推断 XDG app id，推断值通常与安装的 .desktop 文件名
  // 不一致，导致 dock/任务栏图标对不上（PR #304 实践）。.desktop 文件名由
  // electron-builder 按 package.json 的 name（dsh-desktop）派生为
  // dsh-desktop.desktop（与 productName "DSH Desktop" 无关），这里显式对齐。
  if (process.platform === 'linux') {
    app.setDesktopName('dsh-desktop.desktop')
  }
  // utility/GPU 等子进程异常退出落盘
  installChildProcessGoneLogging(app)
  logger.info(`[boot] DSH Desktop 启动，版本 ${app.getVersion()}，日志目录 ${join(app.getPath('userData'), 'logs')}`)
  // 更新生命周期：单飞检查 + 安装前 recheck + 按版本去重后台提示
  updateLifecycle = new UpdateLifecycle(autoUpdater, logger, {
    getWindow: () => mainWindow,
    rebuildTrayMenu,
    rebuildAppMenu,
    requestQuit: () => shutdown(),
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

  // 启动时最小化到托盘：不展示主窗口，仅后台运行（托盘提供恢复入口）
  if (appearance?.launchMinimized) {
    mainWindow?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      try {
        new Notification({ title: 'DSH Desktop', body: '应用已在后台运行，点托盘鲸鱼图标打开。' }).show()
      } catch {
        // 通知失败不阻塞
      }
    }
  }

  // 后台启动 dsh，就绪后加载官方 UI（引擎端口），失败不阻塞（保留回退屏）
  void manager.start().then((s) => {
    if (s.port) windowGen?.loadEngineUI(s.port, manager.token)
  }).catch((err) => {
    logger.error(`[dsh] 启动失败: ${err instanceof Error ? err.stack ?? err.message : err}`)
  })

  // 端口跟随：引擎崩溃重启换端口 → 窗口重新 loadURL 新端口（A0 端口漂移）
  manager.onStatus((s) => {
    if (s.port && s.ready) windowGen?.loadEngineUI(s.port, manager.token)
    // 崩溃恢复态：引擎已死，窗口回退到本地 React UI（展示恢复页）
    if (s.recovery && !s.ready) {
      windowGen?.loadFallback()
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
    shutdown()
  }
})

// 关闭到托盘后没有窗口也不退出（托盘菜单"退出"才真正退出）
app.on('window-all-closed', () => {
  // 有托盘：保持后台运行（任何平台）
  if (tray) return
  // 无托盘（如开发早期）：非 macOS 退出，macOS 保持（符合惯例）
  if (process.platform !== 'darwin') shutdown()
})

// SIGTERM / SIGINT（进程被外部终止）也要清理 dsh 子进程
process.on('SIGTERM', () => shutdown())
process.on('SIGINT', () => shutdown())

// 兜底：应用退出时确保子进程被终止
app.on('will-quit', () => {
  manager?.stop().catch(() => undefined)
})
