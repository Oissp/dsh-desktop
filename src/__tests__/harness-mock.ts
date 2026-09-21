/**
 * React 组件测试共用的 window.harness 桩。
 *
 * 组件在模块顶层就写了 `const harness = window.harness`，引用在 import 的那一刻
 * 就被捕获。因此测试必须在 import 组件之前把桩挂上 window，且整个测试文件复用
 * 同一个桩对象——换对象不生效，组件仍指向旧引用。用法见 App.test.tsx。
 */
import { vi } from 'vitest'
import type { AppSettings, DshStatus, HarnessApi, IpcResult, ModelGroup } from '../../shared/types'

export const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value })
export const err = <T = never>(message: string): IpcResult<T> => ({
  ok: false,
  error: { code: 'E_TEST', message },
})

/** 引擎进程在跑但尚未 ready（App 停在启动屏、Wizard 显示初始化中）。 */
export const STATUS_BOOTING: DshStatus = {
  running: true,
  ready: false,
  port: null,
  version: null,
  cwd: null,
  provider: null,
  model: null,
}

export const STATUS_READY: DshStatus = {
  running: true,
  ready: true,
  port: 51234,
  version: '0.1.6-alpha.2',
  cwd: '/tmp/workspace',
  provider: 'deepseek',
  model: 'DeepSeek-V41-Flash',
}

/** 崩溃环熔断后的恢复态。 */
export const STATUS_RECOVERY: DshStatus = {
  ...STATUS_BOOTING,
  recovery: true,
  error: '内核在短时间内多次崩溃',
}

export const SETTINGS_FRESH: AppSettings = { onboarded: false, workspaceCwd: null }
export const SETTINGS_ONBOARDED: AppSettings = { onboarded: true, workspaceCwd: '/tmp/workspace' }

export const MODEL_GROUPS: ModelGroup[] = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v41-flash', name: 'DeepSeek-V41-Flash' }] },
]

/** 默认实现：所有方法都返回成功，用例只需覆盖自己关心的那个。 */
const DEFAULTS = {
  getAppState: async () => ok<AppSettings>(SETTINGS_FRESH),
  updateAppSettings: async (_patch: Partial<AppSettings>) => ok<AppSettings>(SETTINGS_ONBOARDED),
  getDshStatus: async () => ok<DshStatus>(STATUS_READY),
  ensureDsh: async () => ok<DshStatus>(STATUS_READY),
  restartDsh: async () => ok<DshStatus>(STATUS_READY),
  restoreCheckpointAndRestart: async () => ok<DshStatus>(STATUS_READY),
  openConfigDir: async () => ok<void>(undefined),
  createSession: async (_cwd?: string, _agentPreset?: string) => ok({ sessionId: 's-1' }),
  listModels: async () => ok<ModelGroup[]>(MODEL_GROUPS),
  setApiKey: async (_key: string) => ok<void>(undefined),
  testApiKey: async (_key: string) => ok({ ok: true, message: '连接正常' }),
  pickDirectory: async () => ok<string | null>('/tmp/workspace'),
}

export function createHarnessMock() {
  let statusCb: ((status: DshStatus) => void) | null = null
  const offStatus = vi.fn(() => {
    statusCb = null
  })

  // satisfies 是编译期契约断言：HarnessApi 将来新增方法时这里会报错，提示补桩。
  const mock = {
    getAppState: vi.fn(DEFAULTS.getAppState),
    updateAppSettings: vi.fn(DEFAULTS.updateAppSettings),
    getDshStatus: vi.fn(DEFAULTS.getDshStatus),
    ensureDsh: vi.fn(DEFAULTS.ensureDsh),
    restartDsh: vi.fn(DEFAULTS.restartDsh),
    restoreCheckpointAndRestart: vi.fn(DEFAULTS.restoreCheckpointAndRestart),
    openConfigDir: vi.fn(DEFAULTS.openConfigDir),
    createSession: vi.fn(DEFAULTS.createSession),
    listModels: vi.fn(DEFAULTS.listModels),
    setApiKey: vi.fn(DEFAULTS.setApiKey),
    testApiKey: vi.fn(DEFAULTS.testApiKey),
    pickDirectory: vi.fn(DEFAULTS.pickDirectory),
    onDshStatus: vi.fn((cb: (status: DshStatus) => void) => {
      statusCb = cb
      return offStatus
    }),
  } satisfies Record<keyof HarnessApi, unknown>

  return {
    mock,
    offStatus,
    /** 模拟主进程推送 dsh 状态（需包在 act 里，见 App.test.tsx）。 */
    emitStatus(status: DshStatus) {
      statusCb?.(status)
    },
    /** 清空调用记录并恢复默认实现，供 beforeEach 调用。 */
    reset() {
      vi.clearAllMocks()
      const m = mock as unknown as Record<string, { mockImplementation: (fn: unknown) => void }>
      for (const [key, impl] of Object.entries(DEFAULTS)) {
        m[key].mockImplementation(impl)
      }
    },
  }
}
