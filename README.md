# DSH Desktop

DSH Desktop 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面客户端（Debian 13 / amd64）。应用内置 dsh 引擎，启动后直接加载官方 Web UI；Electron 负责本地运行时、凭证保护、托盘、自动更新和桌面扩展。

> 非 DeepSeek 官方产品，与 DeepSeek 无附属关系。

## 功能

- 内置 dsh 引擎，首次初始化后可直接使用
- 官方 Web UI，支持流式回复、思考过程、工作区、模型和会话管理
- 首启向导配置工作区与模型凭证；引擎崩溃进入恢复模式，可回滚配置快照重启
- 归档会话查看（用引擎自带的三态筛选：隐藏已归档 / 全部对话 / 仅显示已归档）
- 凭证通过 Electron `safeStorage` 加密保存；启用 CSP、导航限制和单实例锁
- 崩溃环检测 + 配置快照恢复、落盘日志
- 崩溃现场报告：主进程、渲染进程、引擎三类崩溃各落一份（版本矩阵、`Error.cause` 链、渲染进程控制台尾部），权限 `0600`，只保留最近 10 份
- 自由文本脱敏：引擎 stderr、崩溃报告与渲染进程控制台里的凭据（各家常量前缀、`Authorization`/`Cookie` 头、`key=value`、URL 查询参数、JWT、PEM 私钥块）统一抹掉后再落盘
- 退出前确认：有会话正在运行（`session.list` 的 `running`）时先弹确认框，默认按钮是「取消」——这个框只在可能丢工作时出现，回车不该杀掉正在跑的回合；探测失败或超时一律按「有任务」处理
- 关机升级阶梯：SIGTERM → 宽限期 → SIGKILL → 确认回收，杀不掉就明确报错，而不是把还活着的引擎当成已停止
- 托盘常驻、后台更新检查和下载后安装
- 发布 Debian 13 / amd64 `.deb` 安装包

## 安装

从项目的 GitHub Releases 下载安装包：

- **Debian 13 / amd64**：`dsh-desktop_<version>_amd64.deb`，然后执行：

  ```bash
  sudo apt install ./dsh-desktop_<version>_amd64.deb
  ```

首次启动会初始化 dsh Web profile，时间取决于本机网络与依赖缓存。随后在首启向导中配置模型凭证。

## 开发

要求：Node.js `>=22.19.0`、pnpm `>=9`。项目使用 pnpm 11；推荐通过 Corepack 管理。

```bash
corepack enable
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm typecheck       # 检查 renderer 与 Electron 两个 TypeScript 项目
pnpm test            # 运行 Vitest
pnpm build           # 构建 renderer 与 Electron 主进程
pnpm dist            # 构建 Debian amd64 .deb 到 out/
```

`pnpm dev` 会启动 Vite（5173）与 Electron。正式应用界面由本地 dsh Web 服务提供；Vite 页面用于启动、首启向导和引擎故障回退。

## 目录结构

```
React 回退 UI（src/） ─→ preload ─→ IPC ─→ Electron 主进程（electron/） ─→ adapter ─→ dsh 引擎（本地回环端口）

dsh-desktop/
├── electron/                  主进程（Node）：生命周期、IPC、引擎、托盘、更新
│   ├── main.ts                入口：窗口 / 托盘 / 菜单 / 退出流程 / 崩溃上报
│   ├── preload.ts             contextBridge：window.harness 与 window.__desktop__
│   ├── ipc.ts                 全部 ipcMain.handle 注册（IPC 通道在此收口）
│   ├── dsh-manager.ts         引擎子进程：启动、端口解析、就绪探测、关机升级阶梯
│   ├── window-generation.ts   窗口创建、导航防护、回退页 / 引擎 UI 切换
│   ├── profile-setup.ts       dsh web profile 初始化与伴随插件安装、清理
│   ├── plugin-manifest.ts     伴随插件注册表（当前为空，机制保留）
│   ├── guard-snapshot.ts      配置快照 / 回滚（守护瀑布）
│   ├── crash-loop-detector.ts 崩溃环熔断
│   ├── crash-report.ts        崩溃现场报告：渲染、落盘、保留 N 份
│   ├── secret-redaction.ts    自由文本凭据脱敏
│   ├── quit-confirmation.ts   退出前「有任务在跑」确认
│   ├── update-lifecycle.ts    更新单飞检查、安装前 recheck、按版本去重提示
│   ├── update-http-executor.ts 带空闲超时的更新传输层
│   ├── update-state.ts        更新状态的持久化
│   ├── credential-store.ts    safeStorage 加密凭证（userData/safe-credentials.json）
│   ├── settings-store.ts      应用设置（userData/app-settings.json）
│   ├── title-snapshot.ts      会话标题快照（会话离开活跃列表时留存归档用元数据）
│   ├── archive-cleanup.ts     硬删会话（归档隐藏 → 删日志 → 排空待解档队列）
│   ├── node-runtime.ts        定位运行引擎的 Node 二进制
│   ├── log-sink.ts            日志落盘
│   ├── desktop-logger.ts      日志器与未捕获异常 / 子进程异常钩子
│   └── __tests__/
├── adapter/                   dsh Typert Remote 协议适配（隔离层）
│   ├── dsh-client.ts          传输：HTTP RPC + WebSocket mux、Cookie 认证
│   ├── events.ts              事件归一化
│   └── index.ts               DshAdapter：对主进程暴露的稳定 API
├── shared/                    renderer 与主进程共享
│   ├── types.ts               IPC 契约（HarnessApi 等，两端锁步）
│   └── fetch-timeout.ts       带超时的 fetch 封装
├── src/                       React 回退 UI（启动 / 首启向导 / 恢复页）
│   ├── App.tsx  main.tsx  styles.css
│   ├── components/            Wizard、WhaleLogo
│   └── __tests__/             含 contract.test.ts：机器校验 IPC 契约三处一致
├── scripts/                   打包钩子与校验
│   ├── after-pack.mjs         node_modules 复制与裁剪（包根 + 包内两级判定）
│   ├── verify-deb.mjs         .deb 产物校验（magic/闭包/平台纯净性/裁剪/桌面标识）
│   ├── smoke-test.mjs         xvfb 下启动 out/linux-unpacked 的冒烟测试
│   ├── compare-dsh-versions.mjs  定时同步的 semver 严格升级门禁
│   ├── ensure-electron.mjs    postinstall 确保 Electron 二进制存在（缺失时补下载）
│   └── lib/                   构建期与校验期共用的定义
│       ├── native-modules.mjs  原生模块族（koffi / node-addon-system）
│       ├── node-runtime.mjs    捆绑 Node 的版本与路径
│       └── deb-trim-rules.mjs  .deb 裁剪断言规则（可单测，见 __tests__）
├── build/                     图标资源（icons 多尺寸 / tray / brand）
├── .github/workflows/         ci.yml（构建 + 测试 + 打包校验）、build-release.yml（发版与依赖同步）
├── electron-builder.yml       打包配置（Debian 13 / amd64）
├── index.html                 Vite 入口（回退 UI）
├── package.json               scripts / 依赖 / engines / desktopName
└── tsconfig.json              renderer；tsconfig.electron.json 主进程；vite / vitest 配置
```

### 代码分区

| 目录 | 进程 | tsconfig | 产物 |
|------|------|----------|------|
| `electron/` | 主进程（Node） | `tsconfig.electron.json` | `dist-electron/` |
| `electron/preload.ts` | preload 桥 | 同上 | 同上 |
| `src/` | 渲染进程（浏览器） | `tsconfig.json` | `dist/`（Vite） |
| `adapter/` | 主进程（被导入） | `tsconfig.electron.json` | `dist-electron/` |
| `shared/` | 两侧 | 两者皆是 | — |
| `scripts/` | 构建/CI（不入产物） | 不在 tsconfig 内，由 Vitest 直接跑 | — |

两个 tsconfig 均以 `ES2024` 为目标与 `lib`：Electron 44.4.5 内置 Node 24.21.0 / Chromium 152，引擎子进程使用的捆绑 Node 同为 24.21.0，全部由 `package.json` 与 `scripts/lib/node-runtime.mjs` 钉死，没有需要兼容的用户环境矩阵，因此这是准确下限而非乐观值；typescript 5.9 的 `lib` 也只到 `es2024`。渲染进程侧的 `target` 只影响类型检查，实际降级由 Vite/esbuild 按自己的基线决定。

### 关键原则：adapter 是隔离边界

渲染进程不接触 dsh 的线上协议，只认识 `window.harness`（类型为 `shared/types.ts` 里的 `HarnessApi`）。主进程通过 `adapter/` 与 dsh 通信。dsh 上游改协议时，只需改 `adapter/dsh-client.ts`（传输）与 `adapter/events.ts`（事件归一化），`shared/types.ts` 与渲染进程保持稳定。

`src/__tests__/contract.test.ts` 会机器校验 `shared/types.ts` 的 `HarnessApi`、`electron/preload.ts`、`electron/ipc.ts` 三者保持锁步。

## 打包与体积

> 目标：在不破坏 dsh 引擎和原生依赖加载的前提下，控制 Debian amd64 `.deb` 的体积。

### 当前打包方式

发布目标仅为 Debian 13 / amd64。`pnpm dist` 会构建 renderer 和 Electron 主进程，再通过 electron-builder 输出 `.deb` 到 `out/`。

dsh 依赖闭包不能交给 electron-builder 的默认依赖收集：在 pnpm 环境下，它可能遗漏 `@deepseek-ai/*` 的传递依赖，导致打包后的引擎无法启动。因此 `scripts/after-pack.mjs` 会：

1. 复制扁平化 `node_modules` 中的运行时依赖
2. 排除 `package.json` 中列出的开发依赖、**以及它们的传递依赖闭包**（见下）和构建工具
3. 排除非目标平台/架构的原生预构建包
4. 验证目标平台的 koffi / node-addon-system 原生二进制实际存在于产物

### 必须保留的内容

- `@deepseek-ai/*` 及其运行时依赖闭包
- `node-pty`、`koffi`、`@deepseek-ai/node-addon-system-linux-x64`（N-API prebuild，0.1.5 起取代 fs-ext）等原生模块
- dsh Web profile 初始化所需文件
- 捆绑的 Node 运行时（`resources/bin/node`）：dsh 0.1.6-alpha.2 起 `node-addon-require-builtin` 在 `ELECTRON_RUN_AS_NODE` 模式下拿不到 V8 embedder context，引擎必须由一份独立 Node 二进制启动
- `@deepseek-ai/libreoffice-kit` 及其平台引擎包（0.1.7 起 Office/PDF 转换依赖）。Linux 侧是 `libreoffice-kit-wasm`（约 195 MB，该包声明 `os: [linux]`，上游没有 Linux 原生包），**是当前 `.deb` 体积的主要来源**。它由 npm 的 `os` 字段完成平台筛选，`after-pack` 的包名模式过滤会原样保留（`-wasm` 不带 `-<platform>-<arch>` 后缀，不会被排除）。与 koffi / node-addon-system 不同，它不参与启动——只在真正跑 Office 转换时惰性解析——因此没有列入 `native-modules.mjs` 的产物断言；若将来要断言它进了产物，需另加一套按 `prebuilds.json` 而非 `.node` 路径的校验。

`asar: false` 同样是必需设置：profile 初始化会创建符号链接，需要真实文件系统路径。

### 不应进入产物的内容

`after-pack.mjs` 会排除开发与构建工具，例如 Electron 开发运行时、electron-builder、TypeScript、Vite、Vitest、类型定义和打包辅助二进制。

仅按名字排除「直接」devDependencies 会漏掉 dev 工具链的传递依赖（babel、vitest 内部包等数百个），它们的名字不在 devDependencies 中，整体复制时会被原样打进产物——这是 `.deb` 体积大头。`after-pack.mjs` 用 `pnpm list` 解析真实依赖树，计算 **dev-only 传递闭包 = (全量闭包) − (prod 闭包)** 并一并排除：这些包不被任何 prod 依赖可达，运行时不会被加载，排除安全。`pnpm list` 失败时回退到仅排除直接 devDependencies（体积偏大但不破坏功能）。

除包根一级外，`shouldExcludeWithinPackage` 还会做**包内**裁剪——这类死重不进包也不影响功能，但会让体积悄悄涨回去，而功能测试全绿：

| 排除项 | 未压缩体积 |
|--------|-----------|
| `node-pty` 非目标平台 prebuild（`prebuilds/` 下除 `linux-x64/` 外的目录） | 约 23 MB |
| `@mixmark-io/domino` 的 `test/` 夹具（运行时只加载 `lib/`） | 约 7 MB |
| `*.d.ts` / `*.d.ts.map` 类型声明 | 约 11 MB |
| `*.tsbuildinfo`、`*.pdb` | — |

注意 `prebuilds/` **容器目录本身必须保留**：`cpSync` 的 filter 拒绝一个目录后就不会再进入它，若在容器一级判为排除，目标平台的 `linux-x64/pty.node` 会跟着一起消失，终端功能直接崩。这条两侧都有断言（`after-pack` 与 `verify-deb`）。

不要通过「只复制少量依赖」的白名单方式进一步裁剪，除非已经验证 dsh 在打包产物中可以启动。

### 验证

每次修改依赖、`after-pack.mjs`、Electron 版本或打包配置后，至少执行：

```bash
pnpm test
pnpm build
pnpm dist
node scripts/verify-deb.mjs
```

`verify-deb.mjs` 检查五类内容，任一不满足即非零退出：

1. **magic bytes** —— 是合法的 ar 归档且首个成员为 `debian-binary`
2. **关键运行时路径** —— `@deepseek-ai/` 闭包、koffi / node-addon-system 平台二进制、主可执行文件、捆绑 Node 运行时
3. **平台纯净性** —— 没有非 `linux-x64` 的 prebuild 包泄入
4. **产物裁剪** —— 上表各项确实没进包，并反向确认目标平台的 `pty.node` 没被误伤
5. **桌面标识** —— `.desktop` 文件名与其 `StartupWMClass` 都等于 `desktopName`

裁剪的断言规则放在 `scripts/lib/deb-trim-rules.mjs`，便于单测：规则作用在 `dpkg-deb -c` 的**真实条目**上（目录条目带结尾 `/`，这是 `after-pack` 的 filter 从来看不到的形态），`scripts/__tests__/deb-trim-rules.test.ts` 会把两种形态与 `after-pack` 的判断方向绑在一起钉住。

CI 还会校验 `.deb` 控制信息、`out/latest-linux.yml`，并用 `scripts/smoke-test.mjs` 在 xvfb 下实际启动 `out/linux-unpacked` 8 秒，确认主进程不立即崩溃、日志被创建、无模块加载失败。实际体积会随 `@deepseek-ai/dsh`、Electron 与原生模块版本变化；以每次构建的 `out/` 产物为准。

## 桌面标识

`.desktop` 的**文件名**、其中的 `StartupWMClass`、以及运行时 Electron 的 `app_id` / X11 `WM_CLASS` 必须是同一个值，否则 X11 会话把窗口关联不到启动器条目（任务栏出现重复或无关联图标）——而 Wayland 走 `app_id`，看不出任何问题，所以这个错很容易漏到发版。

`package.json` 的 `desktopName` 是唯一真源（Electron 启动时读取），`electron-builder.yml` 打开 `linux.syncDesktopName` 让它据此派生 `.desktop` 文件名。缺 `desktopName` 时 electron-builder 会把 `StartupWMClass` **静默回退成 `productName`**，配置里看不出来，所以 `verify-deb.mjs` 会从产物里把 `.desktop` 读回来验。

不要改用 `app.setDesktopName()` 在运行时补：该 API 要求「必须在 `ready` 事件之前调用」，而主进程的初始化都在 `whenReady()` 回调里，在那里调用是无效的。这个契约跨 `package.json`、`electron-builder.yml`、`electron/main.ts` 与 `verify-deb.mjs` 四处，`scripts/__tests__/desktop-identity.test.ts` 在本地（无需 Linux 与已构建的 `.deb`）就能把它钉住。

## License

[MIT](LICENSE)
