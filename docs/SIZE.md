# Debian 安装包体积说明

> 目标：在不破坏 dsh 引擎和原生依赖加载的前提下，控制 Debian amd64 `.deb` 的体积。

## 当前打包方式

发布目标仅为 Debian 13 / amd64。`pnpm dist` 会构建 renderer 和 Electron 主进程，再通过 electron-builder 输出 `.deb` 到 `out/`。

dsh 依赖闭包不能交给 electron-builder 的默认依赖收集：在 pnpm 环境下，它可能遗漏 `@deepseek-ai/*` 的传递依赖，导致打包后的引擎无法启动。因此 `scripts/after-pack.mjs` 会：

1. 复制扁平化 `node_modules` 中的运行时依赖
2. 排除 `package.json` 中列出的开发依赖、**以及它们的传递依赖闭包**（见下）和构建工具
3. 排除非目标平台/架构的原生预构建包
4. 验证目标平台的 koffi / node-addon-system 原生二进制实际存在于产物

## 必须保留的内容

- `@deepseek-ai/*` 及其运行时依赖闭包
- `node-pty`、`koffi`、`@deepseek-ai/node-addon-system-<platform>-<arch>`（N-API prebuild，0.1.5 起取代 fs-ext）等原生模块
- dsh Web profile 初始化所需文件
- `@deepseek-ai/libreoffice-kit` 及其平台引擎包（0.1.7 起 Office/PDF 转换依赖）。按宿主拆成 optionalDependencies：macOS 用 `libreoffice-kit-darwin-arm64`，Linux 用 `libreoffice-kit-wasm`（该包声明 `os: [linux]`，没有 Linux 原生包）。两者各约 200 MB，**是当前 .deb / .dmg 体积的主要来源**。它由 npm 的 `os` 字段完成平台筛选，`after-pack` 的包名模式过滤会原样保留正确的那一个（`-wasm` 不带 `-<platform>-<arch>` 后缀，不会被排除）。与 koffi / node-addon-system 不同，它不参与启动——只在真正跑 Office 转换时惰性解析——因此没有列入 `native-modules.mjs` 的产物断言；若将来要断言它进了产物，需另加一套按 `prebuilds.json` 而非 `.node` 路径的校验。

`asar: false` 同样是必需设置：profile 初始化会创建符号链接，需要真实文件系统路径。

## 不应进入产物的内容

`after-pack.mjs` 会排除开发与构建工具，例如 Electron 开发运行时、electron-builder、TypeScript、Vite、Vitest、类型定义和打包辅助二进制。

仅按名字排除「直接」devDependencies 会漏掉 dev 工具链的传递依赖（babel、vitest 内部包等数百个），它们的名字不在 devDependencies 中，整体复制时会被原样打进产物——这是 `.deb` 体积大头。`after-pack.mjs` 用 `pnpm list` 解析真实依赖树，计算 **dev-only 传递闭包 = (全量闭包) − (prod 闭包)** 并一并排除：这些包不被任何 prod 依赖可达，运行时不会被加载，排除安全。`pnpm list` 失败时回退到仅排除直接 devDependencies（体积偏大但不破坏功能）。

不要通过"只复制少量依赖"的白名单方式进一步裁剪，除非已经验证 dsh 在打包产物中可以启动。

## 验证

每次修改依赖、`after-pack.mjs`、Electron 版本或打包配置后，至少执行：

```bash
pnpm test
pnpm build
pnpm dist
node scripts/verify-deb.mjs
```

CI 还会校验 `.deb` 控制信息和 `out/latest-linux.yml`。实际体积会随 `@deepseek-ai/dsh`、Electron 与原生模块版本变化；以每次构建的 `out/` 产物为准，不在文档中维护与当前发布目标无关的旧平台估算值。
