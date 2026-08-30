import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowResult, WorkflowRunInfo } from '@deepseek-ai/dsh-workflow/types'
import type {
  CancelGraphWorkflowRunRequest,
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowExecutionResult,
  GraphWorkflowFailure,
  GraphWorkflowNodeRunSnapshot,
  GraphWorkflowRunCatalog,
  GraphWorkflowRunReceipt,
  GraphWorkflowRunSnapshot,
  RemoveGraphWorkflowRequest,
  SaveGraphWorkflowRequest,
  StartGraphWorkflowRequest,
} from './domain.ts'
import { deepFreeze, normalizeRunInput } from './domain.ts'
import {
  decodeGraphWorkflowProgramResult,
  graphWorkflowStartRequest,
  prepareGraphWorkflowArguments,
  type GraphWorkflowProgramResult,
} from './executor.ts'
import { GraphWorkflowError, throwIfAborted } from './errors.ts'
import type { GraphWorkflowStore } from './store.ts'

/** Service limits resolved from deployment configuration. */
export interface GraphWorkflowServiceLimits {
  readonly maxInputChars: number
  readonly maxSkillChars: number
  readonly maxResultChars: number
  readonly maxActiveRunsPerAgent: number
  readonly retainedRuns: number
}

interface OwnedRun {
  readonly owner: Agent
  readonly workflow: GraphWorkflowDefinition
  readonly controller: AbortController
  readonly handle: ReturnType<Context['workflowEngine']['start']>
  snapshot: GraphWorkflowRunSnapshot
  settled: Promise<void>
  removeCallerAbort?: () => void
}

/** Host truth for saved definitions and process-local observable DAG runs. */
export class GraphWorkflowService extends TypertRemoteService {
  static inject = ['agents', 'skills', 'workflowEngine']

  private readonly runsById = new Map<string, OwnedRun>()
  private readonly ownerCleanups = new Map<Agent, () => unknown>()
  private admissionOpen = true

  constructor(
    ctx: Context,
    private readonly store: GraphWorkflowStore,
    private readonly limits: GraphWorkflowServiceLimits,
  ) {
    super(ctx, 'graphWorkflows')
    ctx.on('workflow/agent-start', (info, child) => { this.onNodeStart(info, child) })
    ctx.on('workflow/agent-end', (info, child) => { this.onNodeEnd(info, child) })
    ctx.effect(() => async () => { await this.shutdown() }, 'graph-workflows.shutdown')
  }

  /** Read the immutable saved-definition catalog. */
  @Remote('catalog')
  catalog(): GraphWorkflowCatalog {
    return this.store.catalog()
  }

  /** Compare-and-set a complete definition from one exact live Agent. */
  @Remote('save')
  async save(agent: Agent, request: SaveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      return await this.store.save(request)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Compare-and-set removal of one definition from one exact live Agent. */
  @Remote('remove')
  async remove(agent: Agent, request: RemoveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      if ([...this.runsById.values()].some(run => run.workflow.id === request.workflowId && !isSettled(run.snapshot))) {
        throw new GraphWorkflowError(
          `workflow "${request.workflowId}" has an active run`,
          'GRAPH_WORKFLOW_BUSY',
        )
      }
      return await this.store.remove(request)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Start a detached, service-owned browser run after preparation completes. */
  @Remote('start')
  async start(
    agent: Agent,
    request: StartGraphWorkflowRequest,
    signal: AbortSignal,
  ): Promise<GraphWorkflowRunReceipt> {
    try {
      const run = await this.launch(agent, request, signal, false)
      return deepFreeze({
        runId: run.snapshot.runId,
        workflowId: run.workflow.id,
        workflowRevision: run.workflow.revision,
      })
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Run a workflow in the tool caller's foreground cancellation lifetime. */
  async execute(
    agent: Agent,
    request: StartGraphWorkflowRequest,
    signal: AbortSignal,
  ): Promise<GraphWorkflowExecutionResult> {
    const run = await this.launch(agent, request, signal, true)
    await run.settled
    const snapshot = run.snapshot
    if (snapshot.status !== 'succeeded' || snapshot.deliverable === undefined) {
      throw new GraphWorkflowError(
        snapshot.error?.message ?? `workflow "${snapshot.workflowId}" did not complete`,
        signal.aborted ? 'GRAPH_WORKFLOW_ABORTED' : 'GRAPH_WORKFLOW_EXECUTION_FAILED',
      )
    }
    return deepFreeze({
      runId: snapshot.runId,
      workflowId: snapshot.workflowId,
      workflowRevision: snapshot.workflowRevision,
      deliverable: snapshot.deliverable,
    })
  }

  /** List retained runs belonging to the exact current Agent lifecycle. */
  @Remote('runs')
  runs(agent: Agent): GraphWorkflowRunCatalog {
    try {
      this.assertLive(agent)
      return deepFreeze({
        runs: [...this.runsById.values()]
          .filter(run => run.owner === agent)
          .map(run => run.snapshot)
          .sort((left, right) => right.createdAt - left.createdAt),
      })
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Cancel one retained active run owned by the exact current Agent. */
  @Remote('cancel')
  cancel(agent: Agent, request: CancelGraphWorkflowRunRequest): GraphWorkflowRunSnapshot {
    try {
      this.assertLive(agent)
      const run = this.runsById.get(request.runId)
      if (run === undefined || run.owner !== agent) {
        throw new GraphWorkflowError(`run "${request.runId}" was not found`, 'GRAPH_WORKFLOW_RUN_NOT_FOUND')
      }
      if (!isSettled(run.snapshot)) this.cancelRun(run, 'cancelled by user')
      return deepFreeze(run.snapshot)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  private async launch(
    agent: Agent,
    request: StartGraphWorkflowRequest,
    callerSignal: AbortSignal,
    bridgeCaller: boolean,
  ): Promise<OwnedRun> {
    this.assertAdmitting()
    this.assertLive(agent)
    throwIfAborted(callerSignal)
    if (this.activeCount(agent) >= this.limits.maxActiveRunsPerAgent) {
      throw new GraphWorkflowError(
        `agent already has ${String(this.limits.maxActiveRunsPerAgent)} active graph workflow runs`,
        'GRAPH_WORKFLOW_BUSY',
      )
    }
    const workflow = this.store.get(request.workflowId)
    if (workflow === undefined) {
      throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
    }
    const input = normalizeRunInput(workflow, request.input, this.limits.maxInputChars)
    const args = await prepareGraphWorkflowArguments(
      this.ctx.skills,
      workflow,
      input,
      agent,
      callerSignal,
      this.limits.maxSkillChars,
    )

    // Preparation belongs to the request. Publication below transfers the run
    // to the service/Agent lifetime for browser starts.
    this.assertAdmitting()
    this.assertLive(agent)
    throwIfAborted(callerSignal)
    if (this.activeCount(agent) >= this.limits.maxActiveRunsPerAgent) {
      throw new GraphWorkflowError(
        `agent already has ${String(this.limits.maxActiveRunsPerAgent)} active graph workflow runs`,
        'GRAPH_WORKFLOW_BUSY',
      )
    }
    this.ensureOwnerCleanup(agent)
    const controller = new AbortController()
    let removeCallerAbort: (() => void) | undefined
    let publishedHandle: ReturnType<Context['workflowEngine']['start']> | undefined
    if (bridgeCaller) {
      const abort = (): void => {
        controller.abort(callerSignal.reason)
        publishedHandle?.cancel('calling tool step aborted')
      }
      callerSignal.addEventListener('abort', abort, { once: true })
      removeCallerAbort = () => { callerSignal.removeEventListener('abort', abort) }
    }
    let handle: ReturnType<Context['workflowEngine']['start']>
    try {
      handle = this.ctx.workflowEngine.start(graphWorkflowStartRequest(workflow, args, agent, controller.signal))
      publishedHandle = handle
    } catch (error) {
      removeCallerAbort?.()
      controller.abort(error)
      throw error
    }
    const now = Date.now()
    const record: OwnedRun = {
      owner: agent,
      workflow,
      controller,
      handle,
      snapshot: deepFreeze({
        runId: String(handle.id),
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowRevision: workflow.revision,
        revision: 1,
        status: 'running',
        createdAt: now,
        startedAt: now,
        input,
        nodes: workflow.nodes.map(node => ({ nodeId: node.id, name: node.name, status: 'queued' })),
      }),
      settled: Promise.resolve(),
      ...(removeCallerAbort === undefined ? {} : { removeCallerAbort }),
    }
    if (this.runsById.has(record.snapshot.runId)) {
      handle.cancel('duplicate workflow run id')
      void handle.dispose()
      removeCallerAbort?.()
      throw new GraphWorkflowError('workflow engine returned a duplicate run id', 'GRAPH_WORKFLOW_RESULT_INVALID')
    }
    this.runsById.set(record.snapshot.runId, record)
    record.settled = this.settle(record)
    return record
  }

  private onNodeStart(info: WorkflowRunInfo, child: WorkflowAgentInfo): void {
    const run = this.runsById.get(String(info.id))
    const nodeId = nodeIdFromLabel(child.label)
    if (run === undefined || nodeId === undefined || !run.workflow.nodes.some(node => node.id === nodeId)) return
    this.updateNode(run, nodeId, node => ({
      ...node,
      status: 'running',
      startedAt: node.startedAt ?? Date.now(),
    }))
  }

  private onNodeEnd(info: WorkflowRunInfo, child: WorkflowAgentEndInfo): void {
    const run = this.runsById.get(String(info.id))
    const nodeId = nodeIdFromLabel(child.label)
    if (run === undefined || nodeId === undefined || !run.workflow.nodes.some(node => node.id === nodeId)) return
    const status = child.outcome === 'completed' ? 'succeeded' : child.outcome === 'cancelled' ? 'cancelled' : 'failed'
    this.updateNode(run, nodeId, node => ({
      ...node,
      status,
      startedAt: node.startedAt ?? Date.now(),
      endedAt: Date.now(),
      ...(status === 'failed' ? { error: boundedFailure('GRAPH_NODE_FAILED', 'child agent failed', nodeId) } : {}),
    }))
  }

  private async settle(run: OwnedRun): Promise<void> {
    let result: WorkflowResult | undefined
    let disposalError: unknown
    try {
      result = await run.handle.result
    } catch (error) {
      disposalError = error
    } finally {
      try {
        await run.handle.dispose()
      } catch (error) {
        disposalError ??= error
      }
      run.removeCallerAbort?.()
    }
    if (disposalError !== undefined) {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_EXECUTION_FAILED', errorMessage(disposalError)))
      this.prune(run.owner)
      return
    }
    if (result === undefined) {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_RESULT_INVALID', 'workflow engine settled without a result'))
      this.prune(run.owner)
      return
    }
    if (result.stopReason === 'cancelled') {
      this.cancelledRun(run, boundedFailure('GRAPH_WORKFLOW_ABORTED', result.error ?? 'workflow run was cancelled'))
      this.prune(run.owner)
      return
    }
    if (result.stopReason !== 'completed') {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_EXECUTION_FAILED', result.error ?? 'workflow engine failed'))
      this.prune(run.owner)
      return
    }
    try {
      const decoded = decodeGraphWorkflowProgramResult(result.value)
      this.validateDecoded(run, decoded)
      if (!decoded.ok) {
        this.failRun(run, boundedFailure(decoded.failure.code, decoded.failure.message, decoded.failure.nodeId), decoded.outputs)
      } else {
        const outputByNode = new Map(decoded.outputs.map(output => [output.nodeId, output.value]))
        run.snapshot = deepFreeze({
          ...run.snapshot,
          revision: run.snapshot.revision + 1,
          status: 'succeeded',
          endedAt: Date.now(),
          deliverable: decoded.deliverable,
          nodes: run.snapshot.nodes.map(node => ({
            ...node,
            status: 'succeeded',
            startedAt: node.startedAt ?? run.snapshot.startedAt ?? run.snapshot.createdAt,
            endedAt: node.endedAt ?? Date.now(),
            output: outputByNode.get(node.nodeId) as string,
          })),
        })
      }
    } catch (error) {
      this.failRun(run, boundedFailure(
        error instanceof GraphWorkflowError ? error.code : 'GRAPH_WORKFLOW_RESULT_INVALID',
        errorMessage(error),
      ))
    }
    this.prune(run.owner)
  }

  private validateDecoded(run: OwnedRun, result: GraphWorkflowProgramResult): void {
    const nodeIds = new Set(run.workflow.nodes.map(node => node.id))
    const observed = new Set<string>()
    let chars = 0
    for (const output of result.outputs) {
      if (!nodeIds.has(output.nodeId) || observed.has(output.nodeId)) {
        throw new GraphWorkflowError('workflow engine returned unknown or duplicate node output', 'GRAPH_WORKFLOW_RESULT_INVALID')
      }
      observed.add(output.nodeId)
      chars += output.value.length
    }
    if (result.ok) {
      if (observed.size !== nodeIds.size) {
        throw new GraphWorkflowError('workflow engine omitted a successful node output', 'GRAPH_WORKFLOW_RESULT_INVALID')
      }
      const outputNode = result.outputs.find(output => output.nodeId === run.workflow.outputNode)
      if (outputNode?.value !== result.deliverable) {
        throw new GraphWorkflowError('workflow deliverable does not match outputNode', 'GRAPH_WORKFLOW_RESULT_INVALID')
      }
    } else if (result.failure.nodeId !== undefined && !nodeIds.has(result.failure.nodeId)) {
      throw new GraphWorkflowError('workflow engine returned an unknown failed node', 'GRAPH_WORKFLOW_RESULT_INVALID')
    }
    if (chars > this.limits.maxResultChars) {
      throw new GraphWorkflowError(
        `workflow outputs exceed ${String(this.limits.maxResultChars)} characters`,
        'GRAPH_WORKFLOW_RESULT_TOO_LARGE',
      )
    }
  }

  private failRun(
    run: OwnedRun,
    failure: GraphWorkflowFailure,
    outputs: readonly { readonly nodeId: string; readonly value: string }[] = [],
  ): void {
    const outputByNode = new Map(outputs.map(output => [output.nodeId, output.value]))
    run.snapshot = deepFreeze({
      ...run.snapshot,
      revision: run.snapshot.revision + 1,
      status: 'failed',
      endedAt: Date.now(),
      error: failure,
      nodes: run.snapshot.nodes.map(node => {
        const output = outputByNode.get(node.nodeId)
        if (output !== undefined) return { ...node, status: 'succeeded' as const, output, endedAt: node.endedAt ?? Date.now() }
        if (node.nodeId === failure.nodeId) {
          return { ...node, status: 'failed' as const, endedAt: node.endedAt ?? Date.now(), error: failure }
        }
        if (node.status === 'running' || node.status === 'failed') {
          return { ...node, status: 'failed' as const, endedAt: node.endedAt ?? Date.now(), error: node.error ?? failure }
        }
        return { ...node, status: node.status === 'succeeded' ? node.status : 'skipped' as const, endedAt: node.endedAt ?? Date.now() }
      }),
    })
  }

  private cancelledRun(run: OwnedRun, failure: GraphWorkflowFailure): void {
    run.snapshot = deepFreeze({
      ...run.snapshot,
      revision: run.snapshot.revision + 1,
      status: 'cancelled',
      endedAt: Date.now(),
      error: failure,
      nodes: run.snapshot.nodes.map(node => ({
        ...node,
        status: node.status === 'succeeded' ? 'succeeded' : node.status === 'running' ? 'cancelled' : 'skipped',
        endedAt: node.endedAt ?? Date.now(),
      })),
    })
  }

  private updateNode(
    run: OwnedRun,
    nodeId: string,
    update: (node: GraphWorkflowNodeRunSnapshot) => GraphWorkflowNodeRunSnapshot,
  ): void {
    if (isSettled(run.snapshot)) return
    run.snapshot = deepFreeze({
      ...run.snapshot,
      revision: run.snapshot.revision + 1,
      nodes: run.snapshot.nodes.map(node => node.nodeId === nodeId ? update(node) : node),
    })
  }

  private activeCount(owner: Agent): number {
    return [...this.runsById.values()].filter(run => run.owner === owner && !isSettled(run.snapshot)).length
  }

  private prune(owner: Agent): void {
    const settled = [...this.runsById.values()]
      .filter(run => run.owner === owner && isSettled(run.snapshot))
      .sort((left, right) => right.snapshot.createdAt - left.snapshot.createdAt)
    for (const run of settled.slice(this.limits.retainedRuns)) this.runsById.delete(run.snapshot.runId)
  }

  private ensureOwnerCleanup(owner: Agent): void {
    if (this.ownerCleanups.has(owner)) return
    const detach = owner.ctx.effect(() => async () => {
      this.ownerCleanups.delete(owner)
      const owned = [...this.runsById.values()].filter(run => run.owner === owner)
      for (const run of owned) this.cancelRun(run, 'owning agent disposed')
      await Promise.all(owned.map(run => run.settled))
      for (const run of owned) this.runsById.delete(run.snapshot.runId)
    }, 'graph-workflows.ownerCleanup')
    this.ownerCleanups.set(owner, detach)
  }

  private cancelRun(run: OwnedRun, reason: string): void {
    if (isSettled(run.snapshot)) return
    run.controller.abort(new Error(reason))
    run.handle.cancel(reason)
  }

  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new GraphWorkflowError(
        `agent "${agent.id}" is not live in this registry`,
        'GRAPH_WORKFLOW_AGENT_NOT_LIVE',
      )
    }
  }

  private assertAdmitting(): void {
    if (!this.admissionOpen) {
      throw new GraphWorkflowError('graph workflow service is disposing', 'GRAPH_WORKFLOW_DISPOSED')
    }
  }

  private async shutdown(): Promise<void> {
    if (!this.admissionOpen) return
    this.admissionOpen = false
    const runs = [...this.runsById.values()]
    for (const run of runs) this.cancelRun(run, 'graph workflow service disposed')
    await Promise.all(runs.map(run => run.settled))
    await this.store.drain()
    const detachments = [...this.ownerCleanups.values()]
    this.ownerCleanups.clear()
    await Promise.allSettled(detachments.map(detach => Promise.resolve(detach())))
    this.runsById.clear()
  }
}

function nodeIdFromLabel(label: string): string | undefined {
  return label.startsWith('gw:') ? label.slice(3) : undefined
}

function isSettled(snapshot: GraphWorkflowRunSnapshot): boolean {
  return snapshot.status === 'succeeded' || snapshot.status === 'failed' || snapshot.status === 'cancelled'
}

function errorMessage(error: unknown): string {
  const rendered = error instanceof Error ? error.message : String(error)
  return rendered.length <= 1_000 ? rendered : `${rendered.slice(0, 997)}...`
}

function boundedFailure(code: string, message: string, nodeId?: string): GraphWorkflowFailure {
  const bounded = message.length <= 1_000 ? message : `${message.slice(0, 997)}...`
  return deepFreeze({ code, message: bounded, ...(nodeId === undefined ? {} : { nodeId }) })
}

function throwRemoteFailure(error: unknown): never {
  if (error instanceof GraphWorkflowError) {
    throw new TypertRemoteFailure({
      code: error.code,
      message: error.message,
      details: { domain: 'graph-workflow' },
    })
  }
  throw error
}
