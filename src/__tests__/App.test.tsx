// @vitest-environment jsdom
//
// App.tsx 的启动状态机：booting → fatal → recovery → wizard → ready 五态分支，
// 全部由 window.harness 的异步结果驱动。这里锁的是分支选择与副作用清理
// （订阅取消、异步竞态标志），不是像素。
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { IpcResult, DshStatus } from '../../shared/types'
import {
  createHarnessMock,
  err,
  ok,
  SETTINGS_ONBOARDED,
  STATUS_BOOTING,
  STATUS_RECOVERY,
} from './harness-mock'

// 必须在 import App 之前挂桩：组件模块顶层就捕获了 window.harness。
const harness = createHarnessMock()
vi.stubGlobal('harness', harness.mock)
const { default: App } = await import('../App')

describe('App 启动状态机', () => {
  beforeEach(() => {
    harness.reset()
  })

  afterEach(() => {
    cleanup()
  })

  it('引擎尚未就绪时停留在启动屏', async () => {
    harness.mock.ensureDsh.mockImplementation(() => new Promise<never>(() => {}))

    render(<App />)

    expect(screen.getByText('正在启动 DeepSeek Harness 引擎…')).toBeInTheDocument()
  })

  it('ensureDsh 返回错误时显示 fatal 文案与重试按钮', async () => {
    harness.mock.ensureDsh.mockResolvedValue(err<DshStatus>('引擎启动失败：端口未就绪'))

    render(<App />)

    expect(await screen.findByText('引擎启动失败：端口未就绪')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('getAppState 抛异常时也走 fatal 分支', async () => {
    harness.mock.getAppState.mockRejectedValue(new Error('IPC 通道断开'))

    render(<App />)

    expect(await screen.findByText('IPC 通道断开')).toBeInTheDocument()
  })

  it('未完成首启向导时渲染 Wizard', async () => {
    render(<App />)

    expect(await screen.findByText('欢迎使用 DSH Desktop')).toBeInTheDocument()
  })

  it('已完成向导时渲染就绪占位页', async () => {
    harness.mock.getAppState.mockResolvedValue(ok(SETTINGS_ONBOARDED))

    render(<App />)

    expect(await screen.findByText('引擎已就绪，正在打开工作区…')).toBeInTheDocument()
  })

  it('引擎 ready 但未 onboarded 时 Wizard 收到 dshReady=true（显示步骤而非初始化中）', async () => {
    render(<App />)

    expect(await screen.findByText('开始吧')).toBeInTheDocument()
    expect(screen.queryByText('正在初始化引擎…')).not.toBeInTheDocument()
  })

  it('崩溃恢复态渲染恢复页，且优先于向导分支', async () => {
    harness.mock.ensureDsh.mockResolvedValue(ok(STATUS_RECOVERY))

    render(<App />)

    expect(await screen.findByText('引擎反复崩溃，已进入恢复模式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回滚配置并重启' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开配置目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重启内核' })).toBeInTheDocument()
    // 恢复页必须压过向导：用户还没 onboarded，但此时不该看到欢迎页
    expect(screen.queryByText('欢迎使用 DSH Desktop')).not.toBeInTheDocument()
  })

  it('恢复页「重启内核」调用 restartDsh', async () => {
    harness.mock.ensureDsh.mockResolvedValue(ok(STATUS_RECOVERY))
    render(<App />)

    const btn = await screen.findByRole('button', { name: '重启内核' })
    await act(async () => {
      btn.click()
    })

    expect(harness.mock.restartDsh).toHaveBeenCalledTimes(1)
  })

  it('恢复页「回滚配置并重启」调用 restoreCheckpointAndRestart', async () => {
    harness.mock.ensureDsh.mockResolvedValue(ok(STATUS_RECOVERY))
    render(<App />)

    const btn = await screen.findByRole('button', { name: '回滚配置并重启' })
    await act(async () => {
      btn.click()
    })

    expect(harness.mock.restoreCheckpointAndRestart).toHaveBeenCalledTimes(1)
  })

  it('主进程推送 recovery 状态后切换到恢复页', async () => {
    render(<App />)
    await screen.findByText('欢迎使用 DSH Desktop')

    await act(async () => {
      harness.emitStatus(STATUS_RECOVERY)
    })

    expect(screen.getByText('引擎反复崩溃，已进入恢复模式')).toBeInTheDocument()
  })

  it('卸载时取消 dsh:status 订阅', async () => {
    const { unmount } = render(<App />)
    await screen.findByText('欢迎使用 DSH Desktop')

    expect(harness.mock.onDshStatus).toHaveBeenCalledTimes(1)
    unmount()

    // 漏掉这次清理会让主进程持续往已销毁的 webContents 推状态
    expect(harness.offStatus).toHaveBeenCalledTimes(1)
  })

  it('卸载后到达的 ensureDsh 结果不再触发渲染（alive 竞态保护）', async () => {
    let resolveEnsure: (v: IpcResult<DshStatus>) => void = () => {}
    harness.mock.ensureDsh.mockImplementation(
      () => new Promise<IpcResult<DshStatus>>((res) => { resolveEnsure = res }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = render(<App />)
    expect(screen.getByText('正在启动 DeepSeek Harness 引擎…')).toBeInTheDocument()

    unmount()
    await act(async () => {
      resolveEnsure(ok(STATUS_BOOTING))
    })

    // 未加 alive 判断时 React 会对已卸载组件 setState 并打警告
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('初始状态不是 ready 时仍会渲染 Wizard（引擎启动中）', async () => {
    harness.mock.ensureDsh.mockResolvedValue(ok(STATUS_BOOTING))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('正在初始化引擎…')).toBeInTheDocument()
    })
  })
})
