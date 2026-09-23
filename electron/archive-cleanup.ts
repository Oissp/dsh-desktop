/**
 * electron/archive-cleanup.ts —— 硬删的两个引擎侧步骤。
 *
 * 1. `hideForHardDelete`：先归档把会话从活跃列表隐藏（dsh 没有删除 RPC）。
 * 2. `drainPurged`：删掉日志文件后，用 workspace/unarchiveSession 把 id 从引擎
 *    的归档集合里摘掉，否则集合只增不减，归档面板会永远留着文件已删的幽灵行。
 *
 * 唯一的约束：引擎仍持有该会话（live）时不能摘。session.list 会合并内存里的
 * 会话（ApiSessionList.list 经 sessionQuery.listSessions 把 live 会话并入持久
 * 化列表），对 live 会话取消归档等于让它带着原 workspace 槽位复活到活跃列表。
 */

/** 归档步骤只依赖归档与取消两个方法，便于测试注入。 */
export interface HardDeleteTarget {
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<unknown>
  cancelTurn(sessionId: string): Promise<unknown>
}

/**
 * 硬删的隐藏步骤：带 `stopActivity: true` 归档会话，返回是否归档成功。
 *
 * `stopActivity` 不可省。dsh 0.1.7-alpha.1 起引擎在写入前做活跃度检查：会话若有
 * 运行中的回合、子代理、后台任务或定时提醒，不带该标志的归档会被拒绝
 * （`workspace/session-active`），归档集合不变——硬删于是静默失败，会话留在活跃
 * 列表直到引擎重启（日志文件已删，看起来像"删了但没反应"）。带该标志时引擎先落盘
 * 归档，再请求各 provider 停掉这些工作。
 *
 * 归档成功即不再单独取消回合：引擎已代为请求（stopActivity 走的就是"停止并归档"
 * 那条路）。只有归档失败时才兜底取消，避免会话仍在跑却被删了日志。取消失败同样
 * 不抛出——硬删是尽力而为，失败只会让会话多留一会儿。
 *
 * @param target - 提供 archiveSession / cancelTurn 的 adapter
 * @param sessionId - 要隐藏的会话 id
 * @returns true = 已归档（从活跃列表消失）；false = 归档失败（仅兜底取消过回合）
 */
export async function hideForHardDelete(target: HardDeleteTarget, sessionId: string): Promise<boolean> {
  try {
    await target.archiveSession(sessionId, { stopActivity: true })
    return true
  } catch {
    // 归档失败不阻塞删除（尽力而为）
  }
  try {
    await target.cancelTurn(sessionId)
  } catch {
    // 忽略：未运行或已结束
  }
  return false
}

/** 收尾只依赖取消归档一个方法，便于测试注入。 */
export interface UnarchiveTarget {
  unarchiveSession(sessionId: string): Promise<unknown>
}

/**
 * 把队列里"引擎已不再持有"的 id 真正从归档集合里摘掉。
 *
 * 引擎仍持有的（activeIds 命中）跳过：摘掉会让它复活到活跃列表，留给下一轮
 * ——引擎重启后不再持有它，那时才会摘。单个 id 摘除失败也不抛出：引擎瞬时
 * 不可用时留在队列，下轮再试。
 *
 * @param target - 提供 unarchiveSession 的 adapter
 * @param activeIds - 引擎当前仍列出的会话 id（live 或持久化）
 * @param queue - 待取消归档的 id 队列
 * @returns 本次成功摘掉的 id（调用方据此清理本地快照与归档元数据）
 */
export async function drainPurged(
  target: UnarchiveTarget,
  activeIds: ReadonlySet<string>,
  queue: readonly string[],
): Promise<string[]> {
  const drained: string[] = []
  for (const id of queue) {
    if (activeIds.has(id)) continue
    try {
      await target.unarchiveSession(id)
      drained.push(id)
    } catch {
      // 引擎瞬时不可用：留在队列，下轮再试
    }
  }
  return drained
}