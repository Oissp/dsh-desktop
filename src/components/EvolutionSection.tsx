import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, SkillInfo, TaskRecord } from '../../shared/types'

const harness = window.harness

interface Props {
  appSettings: AppSettings
  activeSessionId: string | null
}

interface TimelineEvent {
  time: number
  type: 'task' | 'skill'
  label: string
  summary?: string
}

/** Agent 进化：时间线展示任务完成情况，直观展示同类任务提炼出的技能。 */
export default function EvolutionSection({ appSettings, activeSessionId }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const tasks: TaskRecord[] = appSettings.tasks ?? []

  const refresh = useCallback(async () => {
    if (!activeSessionId) return
    const s = await harness.listSkills(activeSessionId)
    if (s.ok) setSkills(s.value ?? [])
  }, [activeSessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 组装时间线：任务 + 技能，按时间倒序
  const events: TimelineEvent[] = [
    ...tasks.map((t) => ({
      time: t.endedAt ?? t.startedAt,
      type: 'task' as const,
      label: `任务${t.status === 'done' ? '完成' : t.status === 'failed' ? '失败' : '进行中'}`,
      summary: t.title,
    })),
    // 技能无可靠时间戳（Date.now() 会让时间线排序失真）→ 不进时间线，仅计入统计数
  ].sort((a, b) => b.time - a.time)

  const typeColor = (t: TimelineEvent['type']) => `evo-dot-${t}`

  return (
    <section>
      <h3>Agent 进化</h3>
      <p className="hint" style={{ marginBottom: 8 }}>
        agent 持续学习：同类任务达到一定次数后自动提炼成技能。
      </p>

      <div className="evo-stats">
        <div className="evo-stat">
          <span className="evo-stat-num">{tasks.length}</span>
          <span className="evo-stat-label">任务</span>
        </div>
        <div className="evo-stat">
          <span className="evo-stat-num">{skills.length}</span>
          <span className="evo-stat-label">技能</span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="empty-hint">
          <div>还没有进化记录</div>
          <div className="hint">发一条消息让 agent 干活，同类任务积累到一定次数会自动提炼成技能。</div>
        </div>
      ) : (
        <div className="evo-timeline">
          {events.slice(0, 50).map((e, i) => (
            <div key={i} className="evo-event">
              <span className={`evo-dot ${typeColor(e.type)}`} />
              <div className="evo-event-main">
                <div className="evo-event-head">
                  <span className="evo-event-type">{e.label}</span>
                  <span className="evo-event-time mono">{new Date(e.time).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {e.summary && <div className="evo-event-summary">{e.summary}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
