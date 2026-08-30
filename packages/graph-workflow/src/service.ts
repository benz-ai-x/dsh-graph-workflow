import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import { isModelInvocable } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowResult, WorkflowRunInfo } from '@deepseek-ai/dsh-workflow/types'
import type {
  CancelGraphWorkflowRunRequest,
  GraphWorkflowCapabilityCatalog,
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowExecutionResult,
  GraphWorkflowFailure,
  GraphWorkflowNodeRunSnapshot,
  GraphWorkflowRunCatalog,
  GraphWorkflowRunReceipt,
  GraphWorkflowRunSnapshot,
  GraphWorkflowTestCase,
  GraphWorkflowTestCaseCatalog,
  GraphWorkflowTestCasesRequest,
  GraphWorkflowVersionCatalog,
  GraphWorkflowVersionsRequest,
  GraphWorkflowWorkspaceRequest,
  PublishGraphWorkflowRequest,
  RemoveGraphWorkflowTestCaseRequest,
  RemoveGraphWorkflowRequest,
  RestoreGraphWorkflowRequest,
  SaveGraphWorkflowTestCaseRequest,
  SaveGraphWorkflowRequest,
  StartGraphWorkflowRequest,
} from './domain.ts'
import { deepFreeze, normalizeRunInput } from './domain.ts'
import { XIAOHONGSHU_WORKFLOW } from './domain.ts'
import {
  decodeGraphWorkflowProgramResult,
  graphWorkflowStartRequest,
  prepareGraphWorkflowArguments,
  type GraphWorkflowProgramResult,
  type GraphWorkflowProgramOutput,
} from './executor.ts'
import { GraphWorkflowError, throwIfAborted } from './errors.ts'
import { seedWorkflow, type GraphWorkflowStore } from './store.ts'

/** Service limits resolved from deployment configuration. */
export interface GraphWorkflowServiceLimits {
  readonly maxInputChars: number
  readonly maxSkillChars: number
  readonly maxResultChars: number
  readonly maxActiveRunsPerAgent: number
  readonly retainedRuns: number
  readonly seedExample: boolean
}

interface OwnedRun {
  readonly owner: Agent
  readonly workflow: GraphWorkflowDefinition
  readonly controller: AbortController
  readonly handle: WorkflowRun
  snapshot: GraphWorkflowRunSnapshot
  settled: Promise<void>
  removeCallerAbort?: () => void
}

/** Host truth for durable workflow assets/history and live in-flight DAG runs. */
export class GraphWorkflowService extends TypertRemoteService {
  static inject = ['agents', 'skills', 'llm', 'workspaceRegistry']

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

  /** Read the immutable saved-definition catalog for one exact Host Workspace. */
  @Remote('catalog')
  async catalog(request: GraphWorkflowWorkspaceRequest): Promise<GraphWorkflowCatalog> {
    try {
      this.assertAdmitting()
      const owner = this.workspaceIdFromRequest(request)
      return await this.workspaceCatalog(owner)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Read the calling Agent's Workspace catalog for the model-facing tool. */
  async catalogForAgent(agent: Agent): Promise<GraphWorkflowCatalog> {
    this.assertAdmitting()
    this.assertLive(agent)
    const owner = this.workspaceIdForAgent(agent)
    await this.workspaceCatalog(owner)
    return this.store.publishedCatalog(owner)
  }

  /** Read immutable revision history for one Workspace workflow. */
  @Remote('versions')
  async versions(request: GraphWorkflowVersionsRequest): Promise<GraphWorkflowVersionCatalog> {
    try {
      this.assertAdmitting()
      const owner = this.workspaceIdFromRequest(request)
      await this.workspaceCatalog(owner)
      return this.store.versions(owner, request.workflowId)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Resolve advisory Skill and LLM selector choices for the exact live Agent. */
  @Remote('capabilities')
  async capabilities(agent: Agent): Promise<GraphWorkflowCapabilityCatalog> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      const skills = (await this.ctx.skills.list({
        ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
        scope: agent,
      })).filter(isModelInvocable).slice(0, 500).map(skill => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
      }))
      const providers = await Promise.all(this.ctx.llm.listProviders().slice(0, 100).map(async provider => {
        const models = await this.ctx.llm.listModels(provider.id).catch(() => [])
        return {
          id: provider.id,
          name: provider.name,
          models: models.slice(0, 500).map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })),
        }
      }))
      return deepFreeze({ skills, providers })
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Compare-and-set a complete definition from one exact live Agent. */
  @Remote('save')
  async save(agent: Agent, request: SaveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      const owner = this.workspaceIdForAgent(agent)
      await this.store.adoptLegacy(owner)
      return await this.store.save(owner, request)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Make one retained revision the production default. */
  @Remote('publish')
  async publish(agent: Agent, request: PublishGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      return await this.store.publish(this.workspaceIdForAgent(agent), request)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Copy historical content into a new head revision. */
  @Remote('restore')
  async restore(agent: Agent, request: RestoreGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      return await this.store.restore(this.workspaceIdForAgent(agent), request)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  @Remote('testCases')
  testCases(agent: Agent, request: GraphWorkflowTestCasesRequest): GraphWorkflowTestCaseCatalog {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      const owner = this.workspaceIdForAgent(agent)
      if (this.store.get(owner, request.workflowId) === undefined) {
        throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      }
      return this.store.testCases(owner, request.workflowId)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  @Remote('saveTestCase')
  async saveTestCase(agent: Agent, request: SaveGraphWorkflowTestCaseRequest): Promise<GraphWorkflowTestCase> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      return await this.store.saveTestCase(this.workspaceIdForAgent(agent), request.workflowId, request.testCase)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  @Remote('deleteTestCase')
  async deleteTestCase(agent: Agent, request: RemoveGraphWorkflowTestCaseRequest): Promise<GraphWorkflowTestCase> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      return await this.store.removeTestCase(this.workspaceIdForAgent(agent), request.workflowId, request.testCaseId)
    } catch (error) {
      throwRemoteFailure(error)
    }
  }

  /** Compare-and-set removal of one definition from one exact live Agent. */
  @Remote('deleteWorkflow')
  async deleteWorkflow(agent: Agent, request: RemoveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    try {
      this.assertAdmitting()
      this.assertLive(agent)
      const owner = this.workspaceIdForAgent(agent)
      if ([...this.runsById.values()].some(run => run.workflow.workspaceId === owner
        && run.workflow.id === request.workflowId && !isSettled(run.snapshot))) {
        throw new GraphWorkflowError(
          `workflow "${request.workflowId}" has an active run`,
          'GRAPH_WORKFLOW_BUSY',
        )
      }
      return await this.store.remove(owner, request)
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
        workspaceId: run.workflow.workspaceId,
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
      workspaceId: snapshot.workspaceId,
      workflowId: snapshot.workflowId,
      workflowRevision: snapshot.workflowRevision,
      deliverable: snapshot.deliverable,
    })
  }

  /** List live Agent runs plus durable settled history for its Workspace. */
  @Remote('runs')
  runs(agent: Agent): GraphWorkflowRunCatalog {
    try {
      this.assertLive(agent)
      const owner = this.workspaceIdForAgent(agent)
      const live = [...this.runsById.values()]
        .filter(run => run.owner === agent)
        .map(run => run.snapshot)
      const liveIds = new Set(live.map(run => run.runId))
      return deepFreeze({
        runs: [...live, ...this.store.runs(owner).filter(run => !liveIds.has(run.runId))]
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
    const owner = this.workspaceIdForAgent(agent)
    await this.workspaceCatalog(owner)
    const savedWorkflow = this.store.executionDefinition(owner, request.workflowId, request.workflowRevision)
    const workflow = executionScope(savedWorkflow, request.targetNodeId)
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
    const engine = agent.ctx.get('workflowEngine')
    if (engine === undefined) {
      throw new GraphWorkflowError(
        `agent "${agent.id}" does not have an active workflow engine`,
        'GRAPH_WORKFLOW_EXECUTION_FAILED',
      )
    }
    const controller = new AbortController()
    let removeCallerAbort: (() => void) | undefined
    let publishedHandle: WorkflowRun | undefined
    if (bridgeCaller) {
      const abort = (): void => {
        controller.abort(callerSignal.reason)
        publishedHandle?.cancel('calling tool step aborted')
      }
      callerSignal.addEventListener('abort', abort, { once: true })
      removeCallerAbort = () => { callerSignal.removeEventListener('abort', abort) }
    }
    let handle: WorkflowRun
    try {
      handle = engine.start(graphWorkflowStartRequest(workflow, args, agent, controller.signal))
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
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowRevision: workflow.revision,
        revision: 1,
        status: 'running',
        createdAt: now,
        startedAt: now,
        input,
        workflow,
        nodes: workflow.nodes.map(node => ({ nodeId: node.id, name: node.name, status: 'queued' })),
        ...(request.targetNodeId === undefined ? {} : { targetNodeId: request.targetNodeId }),
      }),
      settled: Promise.resolve(),
      ...(removeCallerAbort === undefined ? {} : { removeCallerAbort }),
    }
    if (this.runsById.has(record.snapshot.runId)
      || this.store.runs(workflow.workspaceId).some(run => run.runId === record.snapshot.runId)) {
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
    const liveSnapshot = run.snapshot
    if (disposalError !== undefined) {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_EXECUTION_FAILED', errorMessage(disposalError)))
      await this.archive(run, liveSnapshot)
      return
    }
    if (result === undefined) {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_RESULT_INVALID', 'workflow engine settled without a result'))
      await this.archive(run, liveSnapshot)
      return
    }
    if (result.stopReason === 'cancelled') {
      this.cancelledRun(run, boundedFailure('GRAPH_WORKFLOW_ABORTED', result.error ?? 'workflow run was cancelled'))
      await this.archive(run, liveSnapshot)
      return
    }
    if (result.stopReason !== 'completed') {
      this.failRun(run, boundedFailure('GRAPH_WORKFLOW_EXECUTION_FAILED', result.error ?? 'workflow engine failed'))
      await this.archive(run, liveSnapshot)
      return
    }
    try {
      const decoded = decodeGraphWorkflowProgramResult(result.value)
      this.validateDecoded(run, decoded)
      if (!decoded.ok) {
        this.failRun(run, boundedFailure(decoded.failure.code, decoded.failure.message, decoded.failure.nodeId), decoded.outputs)
      } else {
        const outputByNode = new Map(decoded.outputs.map(output => [output.nodeId, output]))
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
            output: (outputByNode.get(node.nodeId) as GraphWorkflowProgramOutput).value,
            evidence: (outputByNode.get(node.nodeId) as GraphWorkflowProgramOutput).evidence,
          })),
        })
      }
    } catch (error) {
      this.failRun(run, boundedFailure(
        error instanceof GraphWorkflowError ? error.code : 'GRAPH_WORKFLOW_RESULT_INVALID',
        errorMessage(error),
      ))
    }
    await this.archive(run, liveSnapshot)
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
    outputs: readonly GraphWorkflowProgramOutput[] = [],
  ): void {
    const outputByNode = new Map(outputs.map(output => [output.nodeId, output]))
    run.snapshot = deepFreeze({
      ...run.snapshot,
      revision: run.snapshot.revision + 1,
      status: 'failed',
      endedAt: Date.now(),
      error: failure,
      nodes: run.snapshot.nodes.map(node => {
        const output = outputByNode.get(node.nodeId)
        if (node.nodeId === failure.nodeId) {
          return {
            ...node,
            status: 'failed' as const,
            endedAt: node.endedAt ?? Date.now(),
            error: failure,
            ...(output === undefined ? {} : { output: output.value, evidence: output.evidence }),
          }
        }
        if (output !== undefined) return { ...node, status: 'succeeded' as const, output: output.value, evidence: output.evidence, endedAt: node.endedAt ?? Date.now() }
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

  /** A run is observable as settled only after its durable history commit succeeds. */
  private async archive(run: OwnedRun, liveSnapshot: GraphWorkflowRunSnapshot): Promise<void> {
    const settledSnapshot = run.snapshot
    run.snapshot = liveSnapshot
    try {
      await this.store.recordRun(run.workflow.workspaceId, settledSnapshot, this.limits.retainedRuns)
      run.snapshot = settledSnapshot
    } catch (error) {
      run.snapshot = settledSnapshot
      this.failRun(run, boundedFailure(
        error instanceof GraphWorkflowError ? error.code : 'GRAPH_WORKFLOW_STORE_WRITE_FAILED',
        `workflow completed but its run history could not be persisted: ${errorMessage(error)}`,
      ))
    }
    this.prune(run.owner)
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

  private workspaceIdForAgent(agent: Agent): string {
    const workspace = this.ctx.workspaceRegistry.list().find(candidate => candidate.sessionIds.includes(agent.id))
    if (workspace === undefined) {
      throw new GraphWorkflowError(
        `agent "${agent.id}" is not attached to a Workspace`,
        'GRAPH_WORKFLOW_WORKSPACE_NOT_FOUND',
      )
    }
    return String(workspace.id)
  }

  private workspaceIdFromRequest(request: GraphWorkflowWorkspaceRequest): string {
    if (request === null || typeof request !== 'object' || Array.isArray(request)
      || typeof request.workspaceId !== 'string' || request.workspaceId.trim().length === 0) {
      throw new GraphWorkflowError('workspaceId must be a non-empty string', 'GRAPH_WORKFLOW_WORKSPACE_NOT_FOUND')
    }
    const workspace = this.ctx.workspaceRegistry.list()
      .find(candidate => String(candidate.id) === request.workspaceId)
    if (workspace === undefined) {
      throw new GraphWorkflowError(
        `Workspace "${request.workspaceId}" was not found`,
        'GRAPH_WORKFLOW_WORKSPACE_NOT_FOUND',
      )
    }
    return String(workspace.id)
  }

  private async workspaceCatalog(owner: string): Promise<GraphWorkflowCatalog> {
    await this.store.adoptLegacy(owner)
    if (this.limits.seedExample) await seedWorkflow(this.store, owner, XIAOHONGSHU_WORKFLOW)
    return this.store.catalog(owner)
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

function executionScope(workflow: GraphWorkflowDefinition, targetNodeId: string | undefined): GraphWorkflowDefinition {
  if (targetNodeId === undefined) return workflow
  const byId = new Map(workflow.nodes.map(node => [node.id, node]))
  if (!byId.has(targetNodeId)) {
    throw new GraphWorkflowError(`workflow node "${targetNodeId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
  }
  const included = new Set<string>([targetNodeId])
  const visit = (nodeId: string): void => {
    for (const dependency of byId.get(nodeId)?.dependsOn ?? []) {
      if (included.has(dependency)) continue
      included.add(dependency)
      visit(dependency)
    }
  }
  visit(targetNodeId)
  return deepFreeze({
    ...workflow,
    nodes: workflow.nodes.filter(node => included.has(node.id)),
    outputNode: targetNodeId,
  })
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
