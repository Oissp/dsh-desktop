# DSH Desktop

DSH Desktop 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面客户端（Debian 13 / amd64）。应用内置 dsh 引擎，启动后直接加载官方 Web UI；Electron 负责本地运行时、凭证保护、托盘、自动更新与桌面扩展。

> 非 DeepSeek 官方产品，与 DeepSeek 无附属关系。

## 功能

- 内置 `@deepseek-ai/dsh`（0.2.1-alpha.2），首次初始化后即可使用；界面是官方 Web UI：流式回复、思考过程、工作区、模型与会话管理、归档会话三态筛选（隐藏已归档 / 全部对话 / 仅显示已归档）
- 首启向导配置工作区与模型凭证；引擎崩溃进入恢复模式，可回滚配置快照重启
- 凭证经 Electron `safeStorage` 加密保存；启用 CSP、导航限制与单实例锁
- 稳定性：崩溃环检测 + 配置快照回滚、托盘常驻、日志落盘
- 崩溃现场报告：主进程 / 渲染进程 / 引擎三类崩溃各一份（版本矩阵、`Error.cause` 链、渲染进程控制台尾部），权限 `0600`，只保留最近 10 份
- 自由文本脱敏：引擎 stderr、崩溃报告与渲染进程控制台里的凭据（各家前缀常量、`Authorization`/`Cookie` 头、`key=value`、URL 查询参数、JWT、PEM 私钥块）统一抹掉后再落盘
- 退出前确认：有会话正在运行（`session.list` 的 `running`）时先弹确认框，默认按钮是「取消」——探测失败或超时一律按「有任务」处理，回车不该杀掉正在跑的回合
- 关机升级阶梯：SIGTERM → 宽限期 → SIGKILL → 确认回收；杀不掉就明确报错，而不是把还活着的引擎当成已停止
- 后台更新检查、下载后安装；发布 Debian 13 / amd64 `.deb`

## 安装

从项目的 GitHub Releases 下载安装包：

- **Debian 13 / amd64**：`dsh-desktop_<version>_amd64.deb`

  ```bash
  sudo apt install ./dsh-desktop_<version>_amd64.deb
  ```

首次启动会初始化 dsh Web profile，时间取决于本机网络与依赖缓存；随后在首启向导中配置模型凭证。

## 开发

要求：Node.js `>=22.19.0`、pnpm `>=9`。项目使用 pnpm 11，推荐通过 Corepack 管理。

```bash
corepack enable
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm typecheck       # 检查 renderer 与 Electron 两个 TypeScript 项目
pnpm test            # 运行 Vitest（pnpm test:watch 为 watch 模式）
pnpm build           # 构建 renderer 与 Electron 主进程
pnpm dist            # 构建 Debian amd64 .deb 到 out/
```

`pnpm dev` 会启动 Vite（5173）与 Electron。正式界面由本地 dsh Web 服务提供；Vite 页面只用于启动、首启向导和引擎故障回退。

## 项目结构

```
React 回退 UI（src/）─→ preload ─→ IPC ─→ Electron 主进程（electron/）─→ adapter ─→ dsh 引擎（本地回环端口）

electron/   主进程：生命周期、IPC、引擎、托盘、更新、日志、崩溃报告
  ├─ preload.ts         contextBridge：window.harness 与 window.__desktop__
  ├─ dsh-manager.ts     引擎子进程：启动、端口解析、就绪探测、关机升级阶梯
  ├─ ipc.ts             全部 ipcMain.handle 注册（IPC 通道在此收口）
  ├─ window-generation.ts  窗口创建、导航防护、回退页 / 引擎 UI 切换
  ├─ profile-setup.ts   dsh web profile 初始化与伴随插件安装、清理
  ├─ guard-snapshot.ts  配置快照 / 回滚（守护瀑布）；crash-loop-detector.ts 崩溃环熔断
  ├─ archive-cleanup.ts 硬删会话；title-snapshot.ts 会话标题快照
  └─ update-*.ts · credential-store.ts · settings-store.ts · log-sink.ts · crash-report.ts …
adapter/    dsh Typert Remote 协议适配（dsh-client.ts 传输 / events.ts 归一化 / index.ts DshAdapter）
shared/     IPC 契约（types.ts）与 fetch-timeout.ts
src/        React 回退 UI：启动 / 首启向导 / 恢复页
scripts/    打包钩子与校验（after-pack / verify-deb / smoke-test / compare-dsh-versions / lib/）
build/      图标资源 · .github/workflows/  CI（ci.yml）与发版（build-release.yml）
```

### 代码分区

| 目录 | 进程 | tsconfig | 产物 |
|------|------|----------|------|
| `electron/` | 主进程（Node） | `tsconfig.electron.json` | `dist-electron/` |
| `electron/preload.ts` | preload 桥 | 同上 | 同上 |
| `src/` | 渲染进程（浏览器） | `tsconfig.json` | `dist/`（Vite） |
| `adapter/` | 主进程（被导入） | `tsconfig.electron.json` | `dist-electron/` |
| `shared/` | 两侧 | 两者皆是 | — |
| `scripts/` | 构建 / CI（不入产物） | 不在 tsconfig 内，由 Vitest 直接跑 | — |

两个 tsconfig 均以 `ES2024` 为目标与 `lib`：Electron 44.5.1 内置 Node 24.21.0 / Chromium 152，引擎子进程使用的捆绑 Node 同为 24.21.0，全部由 `package.json` 与 `scripts/lib/node-runtime.mjs` 钉死，没有需要兼容的用户环境矩阵，因此这是准确下限而非乐观值；typescript 5.9 的 `lib` 也只到 `es2024`。渲染进程侧的 `target` 只影响类型检查，实际降级由 Vite/esbuild 按自己的基线决定。

### 关键原则：adapter 是隔离边界

渲染进程不接触 dsh 的线上协议，只认识 `window.harness`（类型为 `shared/types.ts` 里的 `HarnessApi`）；主进程通过 `adapter/` 与 dsh 通信。dsh 上游改协议时，只需改 `adapter/dsh-client.ts`（传输）与 `adapter/events.ts`（事件归一化），`shared/types.ts` 与渲染进程保持稳定。`src/__tests__/contract.test.ts` 会机器校验 `HarnessApi`、`electron/preload.ts`、`electron/ipc.ts` 三者锁步。

## 打包与体积

发布目标只有 Debian 13 / amd64。`pnpm dist` 先构建 renderer 与主进程，再由 electron-builder 输出 `.deb` 到 `out/`。

dsh 的依赖闭包不能交给 electron-builder 默认的依赖收集：pnpm 环境下它会遗漏 `@deepseek-ai/*` 的传递依赖，打包后的引擎起不来。因此 `scripts/after-pack.mjs` 整体复制扁平化 `node_modules` 后按需裁剪，并验证目标平台的原生二进制确实在产物里。必须保留的内容：

- `@deepseek-ai/*` 及其运行时依赖闭包、dsh Web profile 初始化所需文件
- 原生模块（N-API prebuild）：`node-pty`、`koffi`、`@deepseek-ai/node-addon-system-linux-x64`（0.1.5 起取代 fs-ext）
- 捆绑 Node 运行时（`resources/bin/node`）：dsh 0.1.6-alpha.2 起 `node-addon-require-builtin` 在 `ELECTRON_RUN_AS_NODE` 模式下拿不到 V8 embedder context，引擎必须由一份独立 Node 二进制启动
- `@deepseek-ai/libreoffice-kit` 的平台引擎包（0.1.7 起 Office/PDF 转换依赖）。Linux 侧是 `libreoffice-kit-wasm`（约 195 MB，上游没有 Linux 原生包），**是当前 `.deb` 体积的主要来源**；它由 npm 的 `os` 字段完成平台筛选（`-wasm` 不带 `-<platform>-<arch>` 后缀，不会被 `after-pack` 的模式过滤误伤），且不参与启动——只在真正跑 Office 转换时惰性解析，故未列入 `native-modules.mjs` 的产物断言

`asar: false` 同样是必需设置：profile 初始化会创建符号链接，需要真实文件系统路径。

裁剪分两级。包根一级排除 dev 与构建工具（Electron 开发运行时、electron-builder、TypeScript、Vite 等）；只按名字排除「直接」devDependencies 会漏掉它们的传递依赖（babel、vitest 内部包等数百个），所以 `after-pack.mjs` 用 `pnpm list` 解析真实依赖树，排除 **dev-only 传递闭包 = 全量闭包 − prod 闭包**（`pnpm list` 失败时回退到只排直接 devDependencies，体积偏大但不破坏功能）。包内一级再裁掉不影响功能的死重：

| 排除项 | 未压缩体积 |
|--------|-----------|
| `node-pty` 非目标平台 prebuild（`prebuilds/` 下除 `linux-x64/` 外的目录） | 约 23 MB |
| `@mixmark-io/domino` 的 `test/` 夹具（运行时只加载 `lib/`） | 约 7 MB |
| `*.d.ts` / `*.d.ts.map` 类型声明 | 约 11 MB |
| `*.tsbuildinfo`、`*.pdb` | — |

注意 `prebuilds/` **容器目录本身必须保留**：`cpSync` 的 filter 拒绝一个目录后就不会再进入它，若在容器一级判为排除，目标平台的 `linux-x64/pty.node` 会跟着消失，终端功能直接崩。这条两侧都有断言。除非已验证打包产物里 dsh 能启动，否则不要改用「只复制少量依赖」的白名单继续裁剪。

### 验证

改依赖、`after-pack.mjs`、Electron 版本或打包配置后至少执行：

```bash
pnpm test && pnpm build && pnpm dist && node scripts/verify-deb.mjs
```

`verify-deb.mjs` 检查五类内容，任一不满足即非零退出：**magic bytes**（合法 ar 归档且首个成员为 `debian-binary`）、**关键运行时路径**（`@deepseek-ai/` 闭包、koffi / node-addon-system 平台二进制、主可执行文件、捆绑 Node）、**平台纯净性**（无非 `linux-x64` prebuild 泄入）、**产物裁剪**（上表各项确实没进包，且反向确认目标平台的 `pty.node` 未被误伤）、**桌面标识**（`.desktop` 文件名与其 `StartupWMClass` 都等于 `desktopName`）。

裁剪断言规则放在 `scripts/lib/deb-trim-rules.mjs` 便于单测：规则作用在 `dpkg-deb -c` 的**真实条目**上（目录条目带结尾 `/`，这是 `after-pack` 的 filter 从来看不到的形态），`scripts/__tests__/deb-trim-rules.test.ts` 把两种形态与 `after-pack` 的判断方向绑在一起钉住。CI 还会校验 `.deb` 控制信息与 `out/latest-linux.yml`，并用 `scripts/smoke-test.mjs` 在 xvfb 下实际启动 `out/linux-unpacked` 8 秒，确认主进程不立即崩溃、日志被创建、无模块加载失败。实际体积随 dsh、Electron 与原生模块版本变化，以每次构建的 `out/` 产物为准。

## 桌面标识

`.desktop` 的**文件名**、其中的 `StartupWMClass`、运行时 Electron 的 `app_id` / X11 `WM_CLASS` 必须是同一个值，否则 X11 把窗口关联不到启动器条目（任务栏出现重复或无关联图标）；Wayland 走 `app_id`，看不出任何问题，所以这个错很容易漏到发版。

`package.json` 的 `desktopName`（`com.dsh.desktop.desktop`，与 `appId` 同源）是唯一真源；`electron-builder.yml` 打开 `linux.syncDesktopName` 让它据此派生 `.desktop` 文件名。缺 `desktopName` 时 electron-builder 会把 `StartupWMClass` **静默回退成 `productName`**，所以 `verify-deb.mjs` 会从产物里把 `.desktop` 读回来验。取 reverse-DNS 形式不只是命名规范：`xdg-desktop-portal` 1.21+ 会拒绝解析不到已安装 `.desktop` 的 `app_id`（GNOME 50 起因此静默拒绝 `globalShortcut` 绑定）；此前把应用固定到启动器/任务栏的用户需要重新固定一次，图标不受影响（`Icon=` 用的是可执行文件名 `dsh-desktop`）。

不要改用 `app.setDesktopName()` 在运行时补：该 API 要求「必须在 `ready` 事件之前调用」，而主进程初始化都在 `whenReady()` 回调里。这个契约跨 `package.json`、`electron-builder.yml`、`electron/main.ts` 与 `verify-deb.mjs` 四处，`scripts/__tests__/desktop-identity.test.ts` 无需 Linux 与已构建的 `.deb` 就能钉住。

## License

[MIT](LICENSE)
