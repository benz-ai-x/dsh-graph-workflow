// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GraphWorkflowDefinition, GraphWorkflowRunSnapshot } from '../src/domain.ts'
import { XIAOHONGSHU_WORKFLOW } from '../src/domain.ts'
import {
  GraphWorkflowStudio,
  type GraphWorkflowStudioProps,
  type UiResult,
} from '../src/client/GraphWorkflowStudio.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const definition: GraphWorkflowDefinition = {
  ...XIAOHONGSHU_WORKFLOW,
  revision: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

function snapshot(status: 'running' | 'succeeded'): GraphWorkflowRunSnapshot {
  const now = 1_700_000_000_000
  return {
    runId: 'visual-run-1',
    workflowId: definition.id,
    workflowName: definition.name,
    workflowRevision: definition.revision,
    revision: status === 'running' ? 2 : 3,
    status,
    createdAt: now,
    startedAt: now,
    ...(status === 'succeeded' ? { endedAt: now + 1_000, deliverable: '可直接发布的最终小红书内容 #体验' } : {}),
    input: {
      topic: '新品咖啡',
      audience: '通勤人群',
      selling_points: '低糖、便携',
      tone: '真诚',
    },
    nodes: definition.nodes.map((node, index) => ({
      nodeId: node.id,
      name: node.name,
      status: status === 'succeeded' ? 'succeeded' : index === 0 ? 'succeeded' : index === 1 ? 'running' : 'queued',
      ...(index === 0 || status === 'succeeded' ? { output: `${node.name} output` } : {}),
    })),
  }
}

const success = <T,>(value: T): UiResult<T> => ({ ok: true, value })

describe('GraphWorkflowStudio', () => {
  it('edits a visual DAG, renders live state, collects structured input, and shows the final deliverable', async () => {
    const catalog = vi.fn().mockResolvedValue(success({ revision: 1, workflows: [definition] }))
    const runs = vi.fn()
      .mockResolvedValueOnce(success({ runs: [snapshot('running')] }))
      .mockResolvedValue(success({ runs: [snapshot('succeeded')] }))
    const start = vi.fn().mockResolvedValue(success({
      runId: 'visual-run-1', workflowId: definition.id, workflowRevision: definition.revision,
    }))
    const props = {
      t: (key: keyof typeof zh) => zh[key],
      catalog,
      runs,
      start,
      save: vi.fn(),
      remove: vi.fn(),
      cancel: vi.fn(),
    } as unknown as GraphWorkflowStudioProps

    const { container } = render(<GraphWorkflowStudio {...props} />)
    await screen.findByText('小红书运营文案')
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByDisplayValue('围绕 {{input.topic}}，面向 {{input.audience}}，根据卖点 {{input.selling_points}} 制定一份小红书内容策略。明确用户痛点、内容钩子、叙事结构和互动问题。')).toBeTruthy()
    expect(screen.getByText('Skill（可选）')).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'subject' } })
    expect(screen.getByDisplayValue(/围绕 \{\{input\.subject\}\}/)).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'topic' } })
    fireEvent.change(screen.getByLabelText('Node ID'), { target: { value: 'strategy' } })
    fireEvent.click(screen.getByRole('button', { name: /首稿撰写/ }))
    expect(screen.getByDisplayValue(/根据策略 \{\{nodes\.strategy\}\}/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    await waitFor(() => { expect(screen.getByText('running')).toBeTruthy() })
    fireEvent.change(screen.getByLabelText('主题/产品 *'), { target: { value: '新品咖啡' } })
    fireEvent.change(screen.getByLabelText('目标人群 *'), { target: { value: '通勤人群' } })
    fireEvent.change(screen.getByLabelText('核心卖点 *'), { target: { value: '低糖、便携' } })
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        workflowId: 'xiaohongshu-content',
        input: {
          topic: '新品咖啡',
          audience: '通勤人群',
          selling_points: '低糖、便携',
          tone: '真诚、有画面感、不过度营销',
        },
      }, expect.any(AbortSignal))
    })
    expect(await screen.findByText('可直接发布的最终小红书内容 #体验')).toBeTruthy()
  })
})
