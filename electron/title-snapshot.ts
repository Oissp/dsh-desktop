/**
 * electron/title-snapshot.ts —— 活跃会话标题快照。
 *
 * dsh 归档 baseline 只给 sessionId + cwd，标题归档后无处可查；桌面端在会话
 * 仍活跃时周期性快照标题，归档后归档列表用快照兜底显示标题。
 */

export interface TitleSnapshotValue {
  title: string
  /** 最后观测时间（epoch ms），用于老化清理已归档/已删除的条目。 */
  at: number
}

/**
 * 折叠一次快照：活跃会话标题写入并刷新 at；不在活跃列表的条目（已归档或已
 * 删除）在 TTL 内保留，超过 TTL 清理。`at` 缺失按 0 处理（立即过期清理）。
 */
export function foldTitleSnapshot(
  prev: Record<string, TitleSnapshotValue> | undefined,
  sessions: { sessionId: string; title: string }[],
  now: number,
  ttlMs: number,
): Record<string, TitleSnapshotValue> {
  const next: Record<string, TitleSnapshotValue> = {}
  for (const s of sessions) {
    if (s.sessionId) next[s.sessionId] = { title: s.title, at: now }
  }
  for (const [id, v] of Object.entries(prev ?? {})) {
    if (!next[id] && now - (v.at ?? 0) < ttlMs) next[id] = v
  }
  return next
}
