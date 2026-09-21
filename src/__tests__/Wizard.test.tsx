// @vitest-environment jsdom
//
// Wizard.tsx 的四步首启向导。这里锁的是流程约束（哪些按钮在什么条件下可点、
// 失败时停在哪一步、finish 的探测分支），这些是重构时最容易悄悄改坏的部分。
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createHarnessMock, err, ok } from './harness-mock'

// 必须在 import Wizard 之前挂桩：组件模块顶层就捕获了 window.harness。
const harness = createHarnessMock()
vi.stubGlobal('harness', harness.mock)
const { default: Wizard } = await import('../components/Wizard')

function setup(dshReady = true) {
  const onComplete = vi.fn()
  const onSkip = vi.fn()
  const view = render(<Wizard dshReady={dshReady} onComplete={onComplete} onSkip={onSkip} />)
  const passwordInput = () =>
    view.container.querySelector('input[type="password"]') as HTMLInputElement
  const click = async (name: string | RegExp) => {
    await act(async () => {
      screen.getByRole('button', { name }).click()
    })
  }
  return { onComplete, onSkip, click, passwordInput, view }
}

/** 走到第 4 步（第 2 步必须填 Key 才能过）。 */
async function advanceToStep4(ctx: ReturnType<typeof setup>, apiKey = 'sk-test') {
  await ctx.click('下一步') // 1 → 2
  fireEvent.change(ctx.passwordInput(), { target: { value: apiKey } })
  await ctx.click('下一步') // 2 → 3（保存 Key）
  await ctx.click('下一步') // 3 → 4
}

describe('Wizard 首启向导', () => {
  beforeEach(() => {
    harness.reset()
  })

  afterEach(() => {
    cleanup()
  })

  it('引擎未就绪时显示初始化提示，不渲染任何步骤', () => {
    setup(false)

    expect(screen.getByText('正在初始化引擎…')).toBeInTheDocument()
    expect(screen.queryByText('开始吧')).not.toBeInTheDocument()
    // 引擎没起来时不该去拉模型列表
    expect(harness.mock.listModels).not.toHaveBeenCalled()
  })

  it('引擎就绪后渲染第 1 步', async () => {
    setup(true)

    expect(await screen.findByText('开始吧')).toBeInTheDocument()
    expect(screen.getByText('第 1 步 / 共 4 步')).toBeInTheDocument()
  })

  it('默认模型名取自 listModels', async () => {
    harness.mock.listModels.mockResolvedValue(
      ok([
        {
          id: 'g1',
          name: 'Group',
          models: [
            { id: 'a', name: 'Model-A' },
            { id: 'b', name: 'Model-B' },
          ],
        },
      ]),
    )

    setup(true)

    expect(await screen.findByText(/Model-A · Model-B/)).toBeInTheDocument()
  })

  it('模型目录为空时回退到硬编码的默认模型名', async () => {
    harness.mock.listModels.mockResolvedValue(ok([]))

    setup(true)

    expect(await screen.findByText(/DeepSeek-V41-Flash/)).toBeInTheDocument()
  })

  it('第 2 步 Key 为空时「下一步」与「测试连接」都禁用', async () => {
    const ctx = setup(true)
    await ctx.click('下一步')

    expect(screen.getByRole('heading', { name: '配置 API Key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  })

  it('填入 Key 后按钮解禁，测试连接成功显示提示', async () => {
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-test' } })

    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
    await ctx.click('测试连接')

    expect(harness.mock.testApiKey).toHaveBeenCalledWith('sk-test')
    expect(screen.getByText('连接正常')).toBeInTheDocument()
  })

  it('测试连接失败时显示错误文案', async () => {
    harness.mock.testApiKey.mockResolvedValue(err('Key 无效'))
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-bad' } })

    await ctx.click('测试连接')

    expect(screen.getByText('Key 无效')).toBeInTheDocument()
  })

  it('保存 Key 失败时停留在第 2 步并显示错误', async () => {
    harness.mock.setApiKey.mockResolvedValue(err('凭据库写入失败'))
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-test' } })

    await ctx.click('下一步')

    expect(screen.getByRole('heading', { name: '配置 API Key' })).toBeInTheDocument()
    expect(screen.getByText('凭据库写入失败')).toBeInTheDocument()
    expect(screen.getByText('第 2 步 / 共 4 步')).toBeInTheDocument()
  })

  it('保存 Key 成功后进入第 3 步', async () => {
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-test' } })

    await ctx.click('下一步')

    expect(harness.mock.setApiKey).toHaveBeenCalledWith('sk-test')
    expect(screen.getByText('选择工作区文件夹')).toBeInTheDocument()
  })

  it('第 2 步可以退回第 1 步，第 1 步没有「上一步」', async () => {
    const ctx = setup(true)
    expect(screen.queryByRole('button', { name: '上一步' })).not.toBeInTheDocument()

    await ctx.click('下一步')
    await ctx.click('上一步')

    expect(screen.getByText('开始吧')).toBeInTheDocument()
  })

  it('选择工作区后展示路径', async () => {
    const ctx = setup(true)
    await advanceToStep4(ctx)

    // 回到第 3 步选文件夹
    await ctx.click('上一步')
    expect(screen.getByText('选择工作区文件夹')).toBeInTheDocument()
    await ctx.click('选择文件夹')

    expect(harness.mock.pickDirectory).toHaveBeenCalledTimes(1)
    expect(screen.getByText('/tmp/workspace')).toBeInTheDocument()
  })

  it('未选工作区时 finish 直接 onComplete(null)，不探测会话', async () => {
    const ctx = setup(true)
    await advanceToStep4(ctx)

    await ctx.click('开始使用')

    expect(harness.mock.createSession).not.toHaveBeenCalled()
    expect(ctx.onComplete).toHaveBeenCalledWith(null)
  })

  it('选了工作区时 finish 先探测 createSession，成功后回传路径', async () => {
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-test' } })
    await ctx.click('下一步')
    await ctx.click('选择文件夹')
    await ctx.click('下一步')
    await ctx.click('开始使用')

    expect(harness.mock.createSession).toHaveBeenCalledWith('/tmp/workspace')
    expect(ctx.onComplete).toHaveBeenCalledWith('/tmp/workspace')
  })

  it('工作区探测失败时停在原地并显示错误，不调 onComplete', async () => {
    harness.mock.createSession.mockResolvedValue(err('目录不可写'))
    const ctx = setup(true)
    await ctx.click('下一步')
    fireEvent.change(ctx.passwordInput(), { target: { value: 'sk-test' } })
    await ctx.click('下一步')
    await ctx.click('选择文件夹')
    await ctx.click('下一步')
    await ctx.click('开始使用')

    expect(screen.getByText('目录不可写')).toBeInTheDocument()
    expect(screen.getByText('第 4 步 / 共 4 步')).toBeInTheDocument()
    expect(ctx.onComplete).not.toHaveBeenCalled()
  })

  it('「稍后配置」调用 onSkip', async () => {
    const ctx = setup(true)

    await ctx.click('稍后配置')

    expect(ctx.onSkip).toHaveBeenCalledTimes(1)
  })

  it('第 4 步展示已配置的 Key 与工作区摘要', async () => {
    const ctx = setup(true)
    await advanceToStep4(ctx)

    expect(screen.getByText(/API Key 已保存/)).toBeInTheDocument()
    expect(screen.getByText(/工作区 （未选择）/)).toBeInTheDocument()
  })
})
