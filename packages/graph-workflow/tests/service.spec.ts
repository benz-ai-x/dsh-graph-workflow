import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResult,
  WorkflowRun,
  WorkflowStartRequest,
} from '@deepseek-ai/dsh-workflow'
import type { GraphWorkflowDraft } from '../src/domain.ts'
import { GraphWorkflowService } from '../src/service.ts'
import { GraphWorkflowStore } from '../src/store.ts'

interface ControlledRun {
  readonly request: WorkflowStartRequest
  readonly run: WorkflowRun
  settle: (result: WorkflowResult) => void
  cancelReason?: string
  disposeCalls: number
  disposeGate?: Promise<void>
}

class StubEngine extends WorkflowEngine {
  readonly runs: ControlledRun[] = []

  start(request: WorkflowStartRequest): WorkflowRun {
    const result = Promise.withResolvers<WorkflowResult>()
    const id = WorkflowRunId(`graph-run-${String(this.runs.length + 1)}`)
    let settled = false
    const settle = (value: WorkflowResult): void => {
      if (settled) return
      settled = true
      result.resolve(value)
    }
    const controlled = {} as ControlledRun
    const run: WorkflowRun = {
      id,
      meta: request.meta,
      result: result.promise,
      cancel: (reason) => {
        controlled.cancelReason = reason
        settle({ value: null, stopReason: 'cancelled', ...(reason === undefined ? {} : { error: reason }), agentsStarted: 0 })
      },
      dispose: async () => {
        controlled.disposeCalls += 1
        await controlled.disposeGate
      },
    }
    Object.assign(controlled, { request, run, settle, disposeCalls: 0 })
    request.signal?.addEventListener('abort', () => {
      settle({ value: null, stopReason: 'cancelled', error: 'signal aborted', agentsStarted: 0 })
    }, { once: true })
    this.runs.push(controlled)
    return run
  }

  nodeStart(index: number, child: WorkflowAgentInfo): void {
    const controlled = this.runs[index] as ControlledRun
    this.emitWorkflowEvent('workflow/agent-start', { id: controlled.run.id, meta: controlled.run.meta }, child)
  }

  nodeEnd(index: number, child: WorkflowAgentEndInfo): void {
    const controlled = this.runs[index] as ControlledRun
    this.emitWorkflowEvent('workflow/agent-end', { id: controlled.run.id, meta: controlled.run.meta }, child)
  }
}

const directories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const draft: GraphWorkflowDraft = {
  id: 'service-flow',
  name: 'Service flow',
  description: 'Service lifecycle test.',
  inputs: [{ key: 'brief', label: 'Brief', required: true }],
  nodes: [
    { id: 'draft', name: 'Draft', dependsOn: [], prompt: '{{input.brief}}' },
    { id: 'deliver', name: 'Deliver', dependsOn: ['draft'], prompt: '{{nodes.draft}}' },
  ],
  outputNode: 'deliver',
}

function fakeAgent(ctx: Context, rawId: string): { agent: Agent; fiber: ReturnType<Context['plugin']> } {
  const fiber = ctx.plugin(() => {})
  const id = SessionId(rawId)
  const session = Session.create(id)
  const agent = {
    id,
    session,
    options: {},
    ctx: fiber.ctx,
    status: 'idle',
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
  } as unknown as Agent
  ctx.agents.register(agent)
  return { agent, fiber }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-service-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SkillRegistry)
  const workspaceSessionIds: SessionId[] = []
  ctx.provide('workspaceRegistry', {
    list: () => [{ id: 'workspace-a', path: '/projects/a', title: 'A', sessionIds: workspaceSessionIds }],
  } as never)
  const store = await GraphWorkflowStore.open(join(directory, 'workflows.json'), {
    maxWorkflows: 10,
    maxNodesPerWorkflow: 10,
    maxInputChars: 1_000,
    maxPromptChars: 2_000,
  })
  const saved = await store.save('workspace-a', { workflow: draft, expectedRevision: 0 })
  await store.publish('workspace-a', { workflowId: saved.id, revision: saved.revision, expectedRevision: saved.revision })
  const service = new GraphWorkflowService(ctx, store, {
    maxInputChars: 1_000,
    maxSkillChars: 2_000,
    maxResultChars: 5_000,
    maxActiveRunsPerAgent: 2,
    retainedRuns: 5,
    seedExample: false,
  })
  const owner = fakeAgent(ctx, `agent-${Math.random().toString(16).slice(2)}`)
  await owner.agent.ctx.plugin(StubEngine)
  workspaceSessionIds.push(owner.agent.id)
  return { ctx, service, store, engine: owner.agent.ctx.get('workflowEngine') as StubEngine, ...owner }
}

function completedValue() {
  return {
    value: {
      ok: true,
      deliverable: 'publish ready',
      outputs: [
        { nodeId: 'draft', value: 'first draft' },
        { nodeId: 'deliver', value: 'publish ready' },
      ],
    },
    stopReason: 'completed' as const,
    agentsStarted: 2,
  }
}

describe('GraphWorkflowService', () => {
  it('projects live node events then publishes success only after engine disposal', async () => {
    const { service, engine, agent } = await setup()
    const receipt = await service.start(agent, { workflowId: 'service-flow', input: { brief: 'hello' } }, new AbortController().signal)
    expect(receipt.runId).toBe('graph-run-1')
    const childId = SessionId('child-1')
    engine.nodeStart(0, { seq: 1, label: 'gw:draft', phase: 'Draft', childId })
    expect(service.runs(agent).runs[0]?.nodes[0]?.status).toBe('running')
    engine.nodeEnd(0, { seq: 1, label: 'gw:draft', phase: 'Draft', childId, outcome: 'completed' })
    engine.nodeStart(0, { seq: 2, label: 'gw:deliver', phase: 'Deliver', childId: SessionId('child-2') })
    engine.nodeEnd(0, { seq: 2, label: 'gw:deliver', phase: 'Deliver', childId: SessionId('child-2'), outcome: 'completed' })
    engine.runs[0]?.settle(completedValue())
    await vi.waitFor(() => { expect(service.runs(agent).runs[0]?.status).toBe('succeeded') })
    expect(service.runs(agent).runs[0]).toMatchObject({
      workspaceId: 'workspace-a',
      workflow: { id: 'service-flow', workspaceId: 'workspace-a', revision: 1 },
      deliverable: 'publish ready',
      nodes: [
        { nodeId: 'draft', status: 'succeeded', output: 'first draft' },
        { nodeId: 'deliver', status: 'succeeded', output: 'publish ready' },
      ],
    })
    expect(engine.runs[0]?.disposeCalls).toBe(1)
  })

  it('defaults to the published revision while browser tests can pin an unpublished revision and one node', async () => {
    const { service, store, engine, agent } = await setup()
    const head = store.get('workspace-a', 'service-flow') as NonNullable<ReturnType<typeof store.get>>
    const draftHead = await store.save('workspace-a', {
      workflow: { ...draft, name: 'Draft revision two' },
      expectedRevision: head.revision,
    })

    const production = await service.start(agent, { workflowId: 'service-flow', input: { brief: 'published' } }, new AbortController().signal)
    expect(production.workflowRevision).toBe(1)
    engine.runs[0]?.settle(completedValue())
    await vi.waitFor(() => { expect(service.runs(agent).runs[0]?.status).toBe('succeeded') })

    const nodeTest = await service.start(agent, {
      workflowId: 'service-flow',
      workflowRevision: draftHead.revision,
      targetNodeId: 'draft',
      input: { brief: 'draft test' },
    }, new AbortController().signal)
    expect(nodeTest.workflowRevision).toBe(2)
    expect((engine.runs[1]?.request.args as { nodes: unknown[] }).nodes).toHaveLength(1)
    expect(engine.runs[1]?.request.meta.phases).toHaveLength(1)
  })

  it('lists model-invocable skills as advisory editor capabilities', async () => {
    const { service, ctx, agent } = await setup()
    const dispose = ctx.skills.register({
      name: 'brand-voice',
      description: 'Approved brand voice',
      source: 'runtime',
      content: 'Use the voice.',
    })
    await expect(service.capabilities(agent)).resolves.toMatchObject({
      skills: [expect.objectContaining({ name: 'brand-voice', description: 'Approved brand voice' })],
      providers: [],
    })
    dispose()
  })

  it('transfers browser runs away from request cancellation after returning the receipt', async () => {
    const { service, engine, agent } = await setup()
    const request = new AbortController()
    await service.start(agent, { workflowId: 'service-flow', input: { brief: 'hello' } }, request.signal)
    request.abort(new Error('browser request ended'))
    expect(engine.runs[0]?.request.signal?.aborted).toBe(false)
    engine.runs[0]?.settle(completedValue())
    await vi.waitFor(() => { expect(service.runs(agent).runs[0]?.status).toBe('succeeded') })
  })

  it('bridges foreground cancellation and maps it to a typed execution failure', async () => {
    const { service, engine, agent } = await setup()
    const controller = new AbortController()
    const pending = service.execute(agent, { workflowId: 'service-flow', input: { brief: 'hello' } }, controller.signal)
    await vi.waitFor(() => { expect(engine.runs).toHaveLength(1) })
    controller.abort(new Error('tool step aborted'))
    await expect(pending).rejects.toMatchObject({ code: 'GRAPH_WORKFLOW_ABORTED' })
    expect(engine.runs[0]?.request.signal?.aborted).toBe(true)
    expect(engine.runs[0]?.disposeCalls).toBe(1)
  })

  it('cancels owned work and waits for run disposal when the Agent scope unloads', async () => {
    const { service, engine, agent, fiber } = await setup()
    await service.start(agent, { workflowId: 'service-flow', input: { brief: 'hello' } }, new AbortController().signal)
    const gate = Promise.withResolvers<void>()
    if (engine.runs[0] !== undefined) engine.runs[0].disposeGate = gate.promise
    let disposed = false
    const pending = fiber.dispose().then(() => { disposed = true })
    await vi.waitFor(() => { expect(engine.runs[0]?.cancelReason).toBe('owning agent disposed') })
    expect(disposed).toBe(false)
    gate.resolve()
    await pending
    expect(service.runs(agent).runs).toEqual([
      expect.objectContaining({ runId: 'graph-run-1', status: 'cancelled' }),
    ])
  })

  it('rejects an impostor Agent even when it reuses a live session id', async () => {
    const { service, agent } = await setup()
    const impostor = { ...agent } as Agent
    const failure = await service.start(impostor, { workflowId: 'service-flow', input: { brief: 'x' } }, new AbortController().signal)
      .then(() => undefined, error => error)
    expect(failure).toBeInstanceOf(TypertRemoteFailure)
    expect((failure as TypertRemoteFailure).failure).toMatchObject({ code: 'GRAPH_WORKFLOW_AGENT_NOT_LIVE' })
  })
})
