# 交付记录

> 当前应用版本：`1.0.13`。
> 本文件仅记录当前项目状态与历史文档入口；旧交付报告不再作为当前实现依据。

## 当前状态

- 目标平台：Debian 13 / amd64（`.deb`）与 macOS arm64（`.dmg` + `.zip`，未签名）
- 应用界面：Electron 启动本地 dsh Web 引擎后加载官方 Web UI
- 桌面能力：首启与故障回退页、凭证安全存储、托盘、自动更新、提醒、记忆插件和归档会话查看
- 发布：GitHub Actions 构建 `.deb` / macOS dmg + zip、`latest-linux.yml` / `latest-mac.yml` 与 blockmap，并以 `v<package.json version>` 创建 Release
- 当前本地插件：`harness-memory`

## 验证基线

提交代码前至少执行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

打包验证执行：

```bash
pnpm dist                      # Debian amd64 .deb
node scripts/verify-deb.mjs    # 校验 deb 结构 / 闭包 / 平台纯净性
pnpm dist:mac                  # macOS dmg + zip（需在 macOS 上执行）
node scripts/verify-mac.mjs    # 校验 mac bundle / 闭包 / 更新元数据
```

CI 会在 Debian 13 容器构建 `.deb`、在 `macos-latest` 构建 macOS 产物，并分别检查控制信息、`.app` bundle、更新元数据与包完整性。上游 dsh 版本同步由发布工作流在定时或手动触发时处理。

## 历史记录

`docs/history/REPORT-001.md` 至 `REPORT-017.md` 保存早期迭代记录。原 `001-030b` 汇总内容对应旧实现、旧平台假设和当时的验证结果，已由 Git 历史保留，不再重复维护。

查看当前代码结构和运行方式，请阅读仓库根目录的 [README.md](../README.md)。
