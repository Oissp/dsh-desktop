/**
 * electron/archive-cleanup.ts —— 硬删后的"取消归档"收尾。
 *
 * 硬删靠 workspace/archiveSession 把会话从活跃列表隐藏（dsh 没有删除 RPC），
 * 删掉日志文件后还要用 workspace/unarchiveSession 把 id 从引擎的归档集合里摘
 * 掉，否则集合只增不减，归档面板会永远留着文件已删的幽灵行。
 *
 * 唯一的约束：引擎仍持有该会话（live）时不能摘。session.list 会合并内存里的
 * 会话（ApiSessionList.list 经 sessionQuery.listSessions 把 live 会话并入持久
 * 化列表），对 live 会话取消归档等于让它带着原 workspace 槽位复活到活跃列表。
 */

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