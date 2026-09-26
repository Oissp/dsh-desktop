/**
 * electron/update-http-executor.ts —— 带「空闲超时」的更新传输层。
 *
 * 借鉴上游 apps/desktop 的 update-http-executor.ts：electron-updater 默认走
 * builder-util-runtime 的 HttpExecutor，其超时实现挂在 request 的 'socket' 事件上
 * 调 socket.setTimeout——那是 Node http.ClientRequest 的模型。Electron 的
 * net.request 返回的 ClientRequest 不保证以同样方式触发该事件，于是**静默连接
 * （TCP 建连后不再有任何字节）会一直挂着**：后台 6 小时一轮的检查永远不返回，
 * 手动检查则只能靠 update-lifecycle 的 25s 兜底计时器补救，且下载阶段完全没有边界。
 *
 * 这里保留 electron-updater 的传输与代理处理，另加一个**空闲**deadline：
 * 响应头到达前、以及响应体两个 chunk 之间，静默超过阈值即判 ETIMEDOUT 并 abort。
 * 注意这不是「整个下载的总时限」——大包慢速下载不会被误杀，只有真卡住才会。
 */
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'

/** 默认空闲上限：60s 无任何字节即判定连接卡死。 */
export const DEFAULT_UPDATE_IDLE_TIMEOUT_MS = 60_000

export class DesktopUpdateHttpExecutor extends ElectronHttpExecutor {
  /**
   * @param idleTimeoutMs 响应头之间 / chunk 之间的最大静默时长，非下载总时限。
   */
  constructor(private readonly idleTimeoutMs: number = DEFAULT_UPDATE_IDLE_TIMEOUT_MS) {
    super()
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 2_147_483_647) {
      throw new Error('更新传输：空闲超时必须为 1000–2147483647 之间的整数')
    }
  }

  override addErrorAndTimeoutHandlers(
    request: Electron.ClientRequest,
    reject: (error: Error) => void,
  ): void {
    // 先让上游挂上它自己的 socket 计时与 error/aborted 处理，行为与默认一致
    super.addErrorAndTimeoutHandlers(request, reject, this.idleTimeoutMs)

    let response: Electron.IncomingMessage | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      request.off('response', onResponse)
      request.off('abort', stop)
      request.off('error', stop)
      response?.off('data', refresh)
      response?.off('end', stop)
      response?.off('error', stop)
    }
    const refresh = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        stop()
        reject(Object.assign(new Error('更新下载连接空闲超时'), { code: 'ETIMEDOUT' }))
        request.abort()
      }, this.idleTimeoutMs)
    }
    const onResponse = (incoming: Electron.IncomingMessage): void => {
      response = incoming
      response.on('data', refresh)
      response.once('end', stop)
      response.once('error', stop)
      refresh()
    }
    request.once('response', onResponse)
    // Electron 44 可能在 finish 之后、响应头到达之前发出 writable close，故一并 stop
    request.once('abort', stop)
    request.once('error', stop)
    // 建连阶段也要计时：否则连接卡在握手时不会有任何事件推动 refresh
    refresh()
  }
}
