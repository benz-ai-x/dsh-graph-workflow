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
  workspaceId: 'workspace-content',
  revision: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

function snapshot(status: 'running' | 'succeeded'): GraphWorkflowRunSnapshot {
  const now = 1_700_000_000_000
  return {
    runId: 'visual-run-1',
    workspaceId: definition.workspaceId,
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
    workflow: definition,
    nodes: definition.nodes.map((node, index) => ({
      nodeId: node.id,
      name: node.name,
      status: status === 'succeeded' ? 'succeeded' : index === 0 ? 'succeeded' : index === 1 ? 'running' : 'queued',
      ...(index === 0 || status === 'succeeded' ? { output: `${node.name} output` } : {}),
      ...(status === 'succeeded' && node.acceptance?.minChars !== undefined ? { evidence: [{
        kind: 'minChars' as const,
        expected: node.acceptance.minChars,
        actual: node.acceptance.minChars + 10,
        passed: true,
        message: '长度验收通过',
      }] } : {}),
    })),
  }
}

const success = <T,>(value: T): UiResult<T> => ({ ok: true, value })

describe('GraphWorkflowStudio', () => {
  it('edits a visual DAG, renders live state, collects structured input, and shows the final deliverable', async () => {
    const catalog = vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, revision: 1, workflows: [definition] }))
    let launched = false
    const runs = vi.fn().mockImplementation(async () => success({ runs: [snapshot(launched ? 'succeeded' : 'running')] }))
    const start = vi.fn().mockImplementation(async () => {
      launched = true
      return success({
        runId: 'visual-run-1', workspaceId: definition.workspaceId,
        workflowId: definition.id, workflowRevision: definition.revision,
      })
    })
    const props = {
      t: (key: keyof typeof zh, variables?: Record<string, unknown>) => {
        const value = zh[key]
        return variables === undefined ? value : Object.entries(variables).reduce(
          (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value as string,
        )
      },
      catalog,
      runs,
      start,
      save: vi.fn(),
      remove: vi.fn(),
      cancel: vi.fn(),
      workspaceId: definition.workspaceId,
      workspaceTitle: '内容增长',
      sessionReady: true,
      initialWorkflowId: definition.id,
      initialView: 'design',
    } as unknown as GraphWorkflowStudioProps

    const { container } = render(<GraphWorkflowStudio {...props} />)
    await screen.findByText('小红书运营文案')
    expect(catalog).toHaveBeenCalledWith({ workspaceId: definition.workspaceId })
    expect((screen.getByLabelText('工作流 ID') as HTMLInputElement).disabled).toBe(true)
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByDisplayValue('围绕 {{input.topic}}，面向 {{input.audience}}，根据卖点 {{input.selling_points}} 制定一份小红书内容策略。明确用户痛点、内容钩子、叙事结构和互动问题。')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '编排' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('status', { name: 'DAG 结构状态' }).textContent).toContain('结构检查通过')
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'invalid-key' } })
    expect(screen.getByText(/结构有误/)).toBeTruthy()
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '返回工作流中心' }))
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab', { name: '编排' })).toBeTruthy()
    confirmDiscard.mockRestore()
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'topic' } })
    fireEvent.click(screen.getByRole('tab', { name: '能力' }))
    expect(screen.getByText('Skill（可选）')).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'subject' } })
    fireEvent.click(screen.getByRole('tab', { name: '提示词' }))
    expect(screen.getByDisplayValue(/围绕 \{\{input\.subject\}\}/)).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('字段 key')[0]!, { target: { value: 'topic' } })
    fireEvent.click(screen.getByRole('tab', { name: '基础' }))
    fireEvent.change(screen.getByLabelText('节点 ID'), { target: { value: 'strategy' } })
    fireEvent.click(screen.getByRole('button', { name: '首稿撰写' }))
    fireEvent.click(screen.getByRole('tab', { name: '提示词' }))
    expect(screen.getByDisplayValue(/根据策略 \{\{nodes\.strategy\}\}/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '测试' }))
    await waitFor(() => { expect(screen.getAllByText('执行中').length).toBeGreaterThan(0) })
    const execute = screen.getByRole('button', { name: /运行完整流程/ })
    expect((execute as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: '必填输入进度' }).textContent).toContain('必填项 0/3')
    fireEvent.change(screen.getByLabelText('主题/产品 *'), { target: { value: '新品咖啡' } })
    fireEvent.change(screen.getByLabelText('目标人群 *'), { target: { value: '通勤人群' } })
    fireEvent.change(screen.getByLabelText('核心卖点 *'), { target: { value: '低糖、便携' } })
    expect((execute as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('status', { name: '必填输入进度' }).textContent).toContain('输入已完整，可以运行')
    fireEvent.click(execute)

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        workflowId: 'xiaohongshu-content',
        workflowRevision: 1,
        input: {
          topic: '新品咖啡',
          audience: '通勤人群',
          selling_points: '低糖、便携',
          tone: '真诚、有画面感、不过度营销',
        },
      }, expect.any(AbortSignal))
    })
    expect(await screen.findByText('可直接发布的最终小红书内容 #体验')).toBeTruthy()
    expect(screen.getByText('长度验收通过')).toBeTruthy()
  })

  it('preserves a stale local draft, fences duplicate saves, and offers explicit conflict recovery', async () => {
    const remote = { ...definition, revision: 2, name: '远端名称', updatedAt: definition.updatedAt + 1 }
    const catalog = vi.fn()
      .mockResolvedValueOnce(success({ workspaceId: definition.workspaceId, revision: 1, workflows: [definition] }))
      .mockResolvedValueOnce(success({ workspaceId: definition.workspaceId, revision: 2, workflows: [remote] }))
    const save = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'GRAPH_WORKFLOW_CONFLICT',
      message: 'GRAPH_WORKFLOW_CONFLICT: stale revision',
    } satisfies UiResult<never>)
    const props = {
      t: (key: keyof typeof zh, variables?: Record<string, unknown>) => {
        const value = zh[key]
        return variables === undefined ? value : Object.entries(variables).reduce(
          (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value as string,
        )
      },
      catalog,
      save,
      versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), remove: vi.fn(), capabilities: vi.fn().mockResolvedValue(success({ skills: [], providers: [] })),
      testCases: vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, workflowId: definition.id, testCases: [] })), saveTestCase: vi.fn(), removeTestCase: vi.fn(), start: vi.fn(),
      runs: vi.fn().mockResolvedValue(success({ runs: [] })), cancel: vi.fn(),
      workspaceId: definition.workspaceId,
      workspaceTitle: '内容增长',
      sessionReady: true,
      initialWorkflowId: definition.id,
      initialView: 'design',
    } as unknown as GraphWorkflowStudioProps

    render(<GraphWorkflowStudio {...props} />)
    await screen.findByText('小红书运营文案')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '我的本地修改' } })
    const saveButton = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    expect(await screen.findByText('检测到较新的远端版本')).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByDisplayValue('我的本地修改')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '另存为副本' }))
    expect(screen.queryByText('检测到较新的远端版本')).toBeNull()
    expect(screen.getByDisplayValue('xiaohongshu-content-copy')).toBeTruthy()
    expect((screen.getByLabelText('工作流 ID') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByDisplayValue('我的本地修改（副本）')).toBeTruthy()
  })

  it('edits edges through ports, deletes a selected edge, persists layout, and supports undo/redo', async () => {
    const catalog = vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, revision: 1, workflows: [definition] }))
    const save = vi.fn().mockImplementation(async (request: { workflow: typeof XIAOHONGSHU_WORKFLOW }) => success({
      ...request.workflow,
      workspaceId: definition.workspaceId,
      revision: 2,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt + 1,
    }))
    const props = {
      t: (key: keyof typeof zh, variables?: Record<string, unknown>) => {
        const value = zh[key]
        return variables === undefined ? value : Object.entries(variables).reduce(
          (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value as string,
        )
      },
      catalog, save,
      versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), remove: vi.fn(), capabilities: vi.fn().mockResolvedValue(success({ skills: [], providers: [] })),
      testCases: vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, workflowId: definition.id, testCases: [] })), saveTestCase: vi.fn(), removeTestCase: vi.fn(), start: vi.fn(),
      runs: vi.fn().mockResolvedValue(success({ runs: [] })), cancel: vi.fn(),
      workspaceId: definition.workspaceId,
      workspaceTitle: '内容增长',
      sessionReady: true,
      initialWorkflowId: definition.id,
      initialView: 'design',
    } as unknown as GraphWorkflowStudioProps

    render(<GraphWorkflowStudio {...props} />)
    await screen.findByText('小红书运营文案')
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    expect(screen.getByRole('button', { name: '节点 5' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.queryByRole('button', { name: '节点 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重做' }))

    const initialEdge = screen.getByRole('button', { name: '连线：发布版交付 到 节点 5' })
    fireEvent.click(initialEdge)
    fireEvent.keyDown(initialEdge, { key: 'Delete' })
    expect(screen.queryByRole('button', { name: '连线：发布版交付 到 节点 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '从“内容策略”开始连线' }))
    fireEvent.click(screen.getByRole('button', { name: '连接到“节点 5”' }))
    expect(screen.getByRole('button', { name: '连线：内容策略 到 节点 5' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '自动布局' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(save).toHaveBeenCalledOnce() })
    const request = save.mock.calls[0]?.[0] as { workflow: GraphWorkflowDefinition }
    expect(request.workflow.nodes.every(node => node.position !== undefined)).toBe(true)
  })

  it('compares immutable versions, publishes with publication CAS, and restores history', async () => {
    const head = { ...definition, revision: 2, name: '当前草稿', publishedRevision: 1, publishedAt: definition.updatedAt, updatedAt: definition.updatedAt + 2 }
    const versionOne = { ...XIAOHONGSHU_WORKFLOW, workspaceId: definition.workspaceId, revision: 1, createdAt: definition.updatedAt }
    const versionTwo = { ...XIAOHONGSHU_WORKFLOW, name: '当前草稿', workspaceId: definition.workspaceId, revision: 2, createdAt: definition.updatedAt + 2 }
    const versions = vi.fn().mockResolvedValue(success({
      workspaceId: definition.workspaceId,
      workflowId: definition.id,
      publishedRevision: 1,
      versions: [versionTwo, versionOne],
    }))
    const publish = vi.fn().mockResolvedValue(success({ ...head, publishedRevision: 2, publishedAt: definition.updatedAt + 3 }))
    const restore = vi.fn().mockResolvedValue(success({ ...definition, revision: 3, publishedRevision: 2, publishedAt: definition.updatedAt + 3 }))
    const props = {
      t: (key: keyof typeof zh, variables?: Record<string, unknown>) => {
        const value = zh[key]
        return variables === undefined ? value : Object.entries(variables).reduce(
          (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value as string,
        )
      },
      catalog: vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, revision: 2, workflows: [head] })),
      versions, publish, restore,
      save: vi.fn(), remove: vi.fn(), capabilities: vi.fn().mockResolvedValue(success({ skills: [], providers: [] })), testCases: vi.fn().mockResolvedValue(success({ workspaceId: definition.workspaceId, workflowId: definition.id, testCases: [] })), saveTestCase: vi.fn(), removeTestCase: vi.fn(),
      start: vi.fn(), runs: vi.fn().mockResolvedValue(success({ runs: [] })), cancel: vi.fn(),
      workspaceId: definition.workspaceId,
      workspaceTitle: '内容增长',
      sessionReady: true,
      initialWorkflowId: definition.id,
      initialView: 'design',
    } as unknown as GraphWorkflowStudioProps

    render(<GraphWorkflowStudio {...props} />)
    await screen.findByText('当前草稿')
    fireEvent.click(screen.getByRole('tab', { name: '版本' }))
    expect(await screen.findByText('版本历史')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '发布 r2' }))
    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith({
        workflowId: definition.id,
        revision: 2,
        expectedRevision: 2,
        expectedPublishedRevision: 1,
      })
    })

    const confirmRestore = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /r1/ }))
    fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }))
    await waitFor(() => { expect(restore).toHaveBeenCalledWith({ workflowId: definition.id, revision: 1, expectedRevision: 2 }) })
    expect(confirmRestore).toHaveBeenCalledOnce()
    confirmRestore.mockRestore()
  })
})
