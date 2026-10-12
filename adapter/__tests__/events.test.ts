import { describe, expect, it } from 'vitest'
import { normalizeSessionEvent, normalizeFollowFrame, normalizeHistory } from '../events'
import type { DshEvent } from '../events'

const base = { sessionId: 's1', seq: 1, time: 0 }

describe('adapter/events normalizeSessionEvent', () => {
  it('assistant/chunk text-delta → assistant-delta', () => {
    const raw = {
      ...base,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '你好' } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toContainEqual({
      kind: 'assistant-delta',
      sessionId: 's1',
      seq: 1,
      turn: 1,
      step: 1,
      text: '你好',
      reasoning: false,
    })
  })

  it('assistant/chunk reasoning-delta → assistant-delta reasoning:true', () => {
    const raw = {
      ...base,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '想' } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out[0]).toMatchObject({ kind: 'assistant-delta', reasoning: true, text: '想' })
  })

  it('assistant/chunk finish error → assistant-end error', () => {
    const raw = {
      ...base,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'error', error: { message: '模型挂了' } } } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out[0]).toMatchObject({ kind: 'assistant-end', error: '模型挂了' })
  })

  it('turn/start → assistant-start + running（真实事件无 step 字段，归一化为 step=1）', () => {
    const raw = { ...base, type: 'turn/start', data: { turn: 1 } } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out[0]).toMatchObject({ kind: 'assistant-start', turn: 1, step: 1 })
    expect(out[1]).toMatchObject({ kind: 'running', running: true })
  })

  it('step/start → assistant-start（不触发 running）', () => {
    const raw = { ...base, type: 'step/start', data: { turn: 1, step: 1 } } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'assistant-start', turn: 1, step: 1 })
  })

  it('step/end → step-end（DSH 0.2.1+ 步骤级边界）', () => {
    const raw = { ...base, type: 'step/end', data: { turn: 1, step: 2 } } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'step-end', turn: 1, step: 2 })
  })

  it('turn/end → 仅推送 running:false（思考/转圈结束）', () => {
    const raw = {
      ...base,
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' }, usage: { inputTokens: 10, outputTokens: 20 } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'running', running: false })
  })

  it('turn/end 错误 reason 经 assistant-end 透传（含 running:false）', () => {
    const raw = {
      ...base,
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'running', running: false })
    expect(out[1]).toMatchObject({ kind: 'assistant-end', error: 'boom' })
  })

  it('user/message 仅 source.kind=user 通过', () => {
    const raw = {
      ...base,
      type: 'user/message',
      data: { id: 'u1', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('user-message')
  })

  it('runtime-context 等注入消息被过滤', () => {
    const raw = {
      ...base,
      type: 'user/message',
      data: { id: 'u2', content: [{ type: 'text', text: 'runtime' }], source: { kind: 'plugin' } },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(0)
  })

  it('system/message → system-message（DSH 0.2.1+ 引擎注入消息）', () => {
    const raw = {
      ...base,
      type: 'system/message',
      data: { id: 'sys1', content: [{ type: 'text', text: '系统提示' }] },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'system-message', sessionId: 's1' })
    expect((out[0] as { message: { blocks: unknown[] } }).message.blocks[0]).toMatchObject({ type: 'text', text: '系统提示' })
  })

  it('developer/message → developer-message（DSH 0.2.1+ 开发者消息）', () => {
    const raw = {
      ...base,
      type: 'developer/message',
      data: { id: 'dev1', content: [{ type: 'text', text: '开发者注入' }] },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'developer-message', sessionId: 's1' })
  })

  it('compaction/summary → compaction-summary（DSH 0.2.1+ 压缩摘要）', () => {
    const raw = {
      ...base,
      type: 'compaction/summary',
      data: { summary: '已压缩 10 条消息' },
    } as unknown as DshEvent
    const out = normalizeSessionEvent('s1', raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'compaction-summary', summary: '已压缩 10 条消息' })
  })

  it('compaction/summary 空 summary 不产生事件', () => {
    const raw = { ...base, type: 'compaction/summary', data: {} } as unknown as DshEvent
    expect(normalizeSessionEvent('s1', raw)).toHaveLength(0)
  })

  it('subagent/start 和 subagent/end → subagent-activity', () => {
    const startRaw = {
      ...base,
      type: 'subagent/start',
      data: { name: 'researcher' },
    } as unknown as DshEvent
    const out1 = normalizeSessionEvent('s1', startRaw)
    expect(out1[0]).toMatchObject({ kind: 'subagent-activity', phase: 'start', name: 'researcher' })

    const endRaw = {
      ...base,
      seq: 2,
      type: 'subagent/end',
      data: { name: 'researcher' },
    } as unknown as DshEvent
    const out2 = normalizeSessionEvent('s1', endRaw)
    expect(out2[0]).toMatchObject({ kind: 'subagent-activity', phase: 'end', name: 'researcher' })
  })

  it('command/run 和 command/done → command', () => {
    const runRaw = {
      ...base,
      type: 'command/run',
      data: { command: '/compact' },
    } as unknown as DshEvent
    const out1 = normalizeSessionEvent('s1', runRaw)
    expect(out1[0]).toMatchObject({ kind: 'command', phase: 'run', name: '/compact' })

    const doneRaw = {
      ...base,
      seq: 2,
      type: 'command/done',
      data: { command: '/compact' },
    } as unknown as DshEvent
    const out2 = normalizeSessionEvent('s1', doneRaw)
    expect(out2[0]).toMatchObject({ kind: 'command', phase: 'done', name: '/compact' })
  })
})

describe('adapter/events normalizeFollowFrame', () => {
  it('event 帧 → 归一化聊天事件', () => {
    const frame = {
      type: 'event',
      event: { type: 'turn/start', seq: 3, time: 0, data: { turn: 1 } },
    }
    const out = normalizeFollowFrame('s1', frame as unknown as Record<string, unknown>)
    expect(out[0]).toMatchObject({ kind: 'assistant-start', sessionId: 's1' })
    expect(out[1]).toMatchObject({ kind: 'running', running: true })
  })

  it('snapshot 帧（adapter 单独消费为历史）→ 空数组', () => {
    const out = normalizeFollowFrame('s1', { type: 'snapshot', records: [] })
    expect(out).toHaveLength(0)
  })
})

describe('adapter/events normalizeHistory', () => {
  it('跳过 assistant/chunk 增量帧（历史只保留完整 assistant/message）', () => {
    const events = [
      { type: 'assistant/chunk', seq: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } } },
      { type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } } },
    ]
    const out = normalizeHistory(events)
    // chunk 被跳过，只剩 assistant/message → assistant-end
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'assistant-end' })
  })

  it('跳过压缩过程明细帧（compaction/start、compaction/prune、compaction/end），保留 summary', () => {
    const events = [
      { type: 'compaction/start', seq: 1, data: {} },
      { type: 'compaction/prune', seq: 2, data: {} },
      { type: 'compaction/summary', seq: 3, data: { summary: '已压缩' } },
      { type: 'compaction/end', seq: 4, data: {} },
    ]
    const out = normalizeHistory(events)
    // start/prune/end 被跳过，只保留 summary
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'compaction-summary', summary: '已压缩' })
  })

  it('保留 system/message 和 developer/message（归档历史可见）', () => {
    const events = [
      { type: 'system/message', seq: 1, data: { id: 's1', content: [{ type: 'text', text: 'sys' }] } },
      { type: 'developer/message', seq: 2, data: { id: 'd1', content: [{ type: 'text', text: 'dev' }] } },
    ]
    const out = normalizeHistory(events)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'system-message' })
    expect(out[1]).toMatchObject({ kind: 'developer-message' })
  })
})
