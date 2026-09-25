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

## 架构

```
React fallback UI (src/) -> preload -> IPC -> Electron main -> adapter -> dsh web engine
```

- `adapter/`：dsh Typert Remote 协议适配（HTTP RPC + WebSocket mux）与事件归一化
- `shared/`：renderer 与主进程共享的稳定类型和 IPC 契约
- `electron/`：引擎生命周期、IPC、凭证、profile、托盘、更新和桌面桥接
- `src/`：React 回退 UI（启动、首启向导、恢复页与引擎就绪过渡占位）
- `scripts/`：打包钩子、校验脚本、原生模块定义

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

不要通过「只复制少量依赖」的白名单方式进一步裁剪，除非已经验证 dsh 在打包产物中可以启动。

### 验证

每次修改依赖、`after-pack.mjs`、Electron 版本或打包配置后，至少执行：

```bash
pnpm test
pnpm build
pnpm dist
node scripts/verify-deb.mjs
```

CI 还会校验 `.deb` 控制信息、`out/latest-linux.yml`，并用 `scripts/smoke-test.mjs` 在 xvfb 下实际启动 `out/linux-unpacked` 8 秒，确认主进程不立即崩溃、日志被创建、无模块加载失败。实际体积会随 `@deepseek-ai/dsh`、Electron 与原生模块版本变化；以每次构建的 `out/` 产物为准。

## License

[MIT](LICENSE)
