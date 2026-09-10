import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, DshStatus } from '../shared/types'
import Wizard from './components/Wizard'
import WhaleLogo from './components/WhaleLogo'

const harness = window.harness

export default function App() {
  return <DesktopApp />
}

function DesktopApp() {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [dshStatus, setDshStatus] = useState<DshStatus | null>(null)
  const [booting, setBooting] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [stateRes, statusRes] = await Promise.all([harness.getAppState(), harness.ensureDsh()])
        if (!alive) return
        if (stateRes.ok) setAppSettings(stateRes.value!)
        if (statusRes.ok) setDshStatus(statusRes.value!)
        else if (statusRes.error) setFatal(statusRes.error.message)
      } catch (e) {
        if (alive) setFatal((e as Error).message)
      } finally {
        if (alive) setBooting(false)
      }
    })()

    const offStatus = harness.onDshStatus((s) => {
      if (alive) setDshStatus(s)
    })
    return () => {
      alive = false
      offStatus()
    }
  }, [])

  const onCompleteWizard = useCallback(async (workspaceCwd: string | null) => {
    const res = await harness.updateAppSettings({ onboarded: true, workspaceCwd: workspaceCwd || null })
    if (res.ok) setAppSettings(res.value!)
  }, [])

  const onSkipWizard = useCallback(async () => {
    const res = await harness.updateAppSettings({ onboarded: true })
    if (res.ok) setAppSettings(res.value!)
  }, [])

  if (booting) {
    return (
      <div className="boot-screen">
        <WhaleLogo className="boot-logo" />
        <div className="boot-text">正在启动 DeepSeek Harness 引擎…</div>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="boot-screen">
        <div className="boot-text">{fatal}</div>
        <button className="btn primary" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    )
  }

  // 崩溃恢复态：引擎反复崩溃已触发崩溃环熔断，展示恢复页 + 自助恢复操作。
  if (dshStatus?.recovery) {
    const busy = restarting || restoring
    return (
      <div className="boot-screen">
        <WhaleLogo className="boot-logo" />
        <div className="boot-text">引擎反复崩溃，已进入恢复模式</div>
        <div className="boot-subtext" style={{ fontSize: 13, color: 'var(--dsw-text-2)', marginTop: 4, maxWidth: 420, textAlign: 'center' }}>
          {dshStatus.error ?? '内核在短时间内多次崩溃，已停止自动重启。可回滚到上次良好配置，或检查配置后重启。'}
        </div>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setRestoring(true)
            try {
              const res = await harness.restoreCheckpointAndRestart()
              if (!res.ok && res.error) setFatal(res.error.message)
            } catch (e) {
              setFatal((e as Error).message)
            } finally {
              setRestoring(false)
            }
          }}
        >
          {restoring ? '正在回滚…' : '回滚配置并重启'}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            const res = await harness.openConfigDir()
            if (!res.ok && res.error) setFatal(res.error.message)
          }}
        >
          打开配置目录
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setRestarting(true)
            try {
              const res = await harness.restartDsh()
              if (!res.ok && res.error) setFatal(res.error.message)
            } catch (e) {
              setFatal((e as Error).message)
            } finally {
              setRestarting(false)
            }
          }}
        >
          {restarting ? '正在重启…' : '重启内核'}
        </button>
      </div>
    )
  }

  if (!appSettings?.onboarded) {
    return (
      <Wizard
        dshReady={dshStatus?.ready ?? false}
        onComplete={onCompleteWizard}
        onSkip={onSkipWizard}
      />
    )
  }

  // 已就绪：主进程随即把窗口切到官方引擎 UI，这里仅作过渡占位
  return (
    <div className="ready-screen">
      <WhaleLogo className="boot-logo" />
      <div className="boot-text">
        {dshStatus?.ready ? '引擎已就绪，正在打开工作区…' : '引擎启动中…'}
      </div>
    </div>
  )
}
