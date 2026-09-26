/**
 * scripts/__tests__/desktop-identity.test.ts —— Linux 桌面标识的三处对齐。
 *
 * app_id / WM_CLASS（运行时）、.desktop 的文件名与其中的 StartupWMClass（构建产物）
 * 必须是同一个值。三者不一致时，X11 会话把窗口关联不到启动器条目 —— 表现为任务栏
 * 出现重复图标或图标不跟随，而 **Wayland 走 app_id 所以完全看不出问题**，
 * 因此这个错很容易一路漏到发版（DeX 上 GNOME 默认 Wayland，实际用户多半是 X11/XWayland
 * 或 Cinnamon/XFCE 时才发现）。
 *
 * 这个契约跨四个文件，单看任何一个都看不出问题：
 *   · package.json 的 desktopName —— 唯一真源，Electron 启动时读它当 app_id
 *   · electron-builder.yml 的 linux.syncDesktopName —— 决定 .desktop 文件名
 *   · electron/main.ts —— 不能再用 app.setDesktopName 去"补"，见下面第一条
 *   · scripts/verify-deb.mjs —— 从产物读回来验（本文件跑不了那个，需要 dpkg-deb）
 * 所以在这里钉住。verify-deb 需要 Linux 与已构建的 .deb，本地 macOS 开发机上跑不了。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const pkg = JSON.parse(read('package.json')) as { name: string; desktopName?: string }
const builder = parseYaml(read('electron-builder.yml')) as {
  appId?: string
  linux?: { syncDesktopName?: boolean; desktopName?: string }
}

describe('desktopName 是唯一真源', () => {
  it('package.json 显式声明 desktopName（不是靠 Electron 的 slug 回退）', () => {
    // Electron 文档：未设置时会回退成应用名的小写连字符 slug。当前应用名恰好是
    // dsh-desktop，回退值**碰巧**与期望一致 —— 这正是以前没人发现问题的原因，
    // 也让"回退"和"显式声明"难以区分。显式声明后改应用名不会再悄悄改掉 app_id。
    expect(typeof pkg.desktopName).toBe('string')
    expect(pkg.desktopName?.trim()).not.toBe('')
    expect(pkg.desktopName?.endsWith('.desktop')).toBe(true)
  })

  it('desktopName 必须写在 package.json，不是 electron-builder.yml 的 linux 块', () => {
    // electron-builder 读的是 packager.info.metadata.desktopName（= package.json）。
    // 写进 linux 块不生效，但看起来像是配好了 —— 于是 StartupWMClass 悄悄回退成
    // productName 而没人察觉。这条挡住那种"改在错的地方"的修法。
    expect(builder.linux?.desktopName).toBeUndefined()
  })
})

describe('构建侧派生 .desktop 文件名与 StartupWMClass', () => {
  it('linux.syncDesktopName 打开（否则文件名走 executableName，与 desktopName 脱钩）', () => {
    expect(builder.linux?.syncDesktopName).toBe(true)
  })

  it('appId 与 desktopName 同属桌面身份体系，不应互相矛盾', () => {
    // appId 给 deb 包元数据，desktopName 给窗口/启动器关联。二者值不同是允许的
    // （appId 用 reverse-DNS，desktopName 历史上是 dsh-desktop.desktop），
    // 但至少都要有 —— 缺一个就是又回到"靠回退"的状态。
    expect(typeof builder.appId).toBe('string')
    expect(builder.appId).not.toBe('')
  })
})

describe('运行时侧不得再调 setDesktopName', () => {
  // 先去掉行注释再断言：源码里有解释"为什么不调它"的注释会提到这个 API 名，
  // 断言的是**调用**而不是字样。
  const mainSource = read('electron/main.ts').replace(/^[ \t]*\/\/.*$/gm, '')

  it('main.ts 里没有 app.setDesktopName 调用（该 API 必须在 ready 之前调用）', () => {
    // Electron 文档明确：「This API must be called before the `ready` event.」
    // 而 main.ts 的初始化都在 app.whenReady() 回调里 —— 放在那里已经太晚。
    // 值改由 package.json 声明（Electron 启动时读取），所以运行时调用既冗余又是
    // 时序陷阱：它看着像是在起作用，实际没有，一旦有人改了 package.json 的值
    // 就会以为这行也会跟着对齐。
    expect(mainSource).not.toMatch(/app\s*\.\s*setDesktopName\s*\(/)
  })
})
