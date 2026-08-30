import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  GraphWorkflowAcceptanceEvidence,
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowDraft,
  GraphWorkflowFailure,
  GraphWorkflowLimits,
  GraphWorkflowNodeRunSnapshot,
  GraphWorkflowRunSnapshot,
  GraphWorkflowTestCase,
  GraphWorkflowTestCaseCatalog,
  GraphWorkflowTestCaseDraft,
  GraphWorkflowVersion,
  GraphWorkflowVersionCatalog,
  PublishGraphWorkflowRequest,
  RemoveGraphWorkflowRequest,
  RestoreGraphWorkflowRequest,
  SaveGraphWorkflowRequest,
} from './domain.ts'
import { deepFreeze, normalizeRunInput, normalizeWorkflowDraft } from './domain.ts'
import { GraphWorkflowError } from './errors.ts'

const STORE_SCHEMA_VERSION = 4
const LEGACY_WORKSPACE_ID = '__legacy__'
const TEST_CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const NODE_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'])
const EVIDENCE_KINDS = new Set(['minChars', 'mustInclude', 'forbidden'])

interface StoreDocument {
  readonly schemaVersion: 4
  readonly revision: number
  readonly workflows: readonly GraphWorkflowDefinition[]
  readonly versions: readonly GraphWorkflowVersion[]
  readonly runs: readonly GraphWorkflowRunSnapshot[]
  readonly testCases: readonly GraphWorkflowTestCase[]
  /** Workspaces whose optional starter decision has already been committed. */
  readonly initializedWorkspaceIds: readonly string[]
}

function emptyDocument(): StoreDocument {
  return deepFreeze({
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    workflows: [],
    versions: [],
    runs: [],
    testCases: [],
    initializedWorkspaceIds: [],
  })
}

function invalid(message: string): never {
  throw new GraphWorkflowError(message, 'GRAPH_WORKFLOW_STORE_INVALID')
}

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(`${label} must be a safe integer >= ${String(minimum)}`)
  return value as number
}

function optionalInteger(value: unknown, label: string, minimum: number): number | undefined {
  return value === undefined ? undefined : safeInteger(value, label, minimum)
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    invalid(`${label} must be a non-empty string of at most ${String(maximum)} characters`)
  }
  return value
}

function workspaceId(value: unknown, label: string): string {
  return boundedString(value, label, 200)
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function decodeDefinition(
  raw: unknown,
  schemaVersion: number,
  limits: GraphWorkflowLimits,
  label: string,
): GraphWorkflowDefinition {
  const source = recordOf(raw, label)
  const draft = normalizeWorkflowDraft(source as unknown as GraphWorkflowDraft, limits)
  const owner = schemaVersion === 1 ? LEGACY_WORKSPACE_ID : workspaceId(source['workspaceId'], `${label}.workspaceId`)
  const revision = safeInteger(source['revision'], `${label}.revision`, 1)
  const createdAt = safeInteger(source['createdAt'], `${label}.createdAt`, 0)
  const updatedAt = safeInteger(source['updatedAt'], `${label}.updatedAt`, createdAt)
  if (updatedAt < createdAt) invalid(`${label}.updatedAt precedes createdAt`)
  const publishedRevision = schemaVersion < STORE_SCHEMA_VERSION
    ? revision
    : optionalInteger(source['publishedRevision'], `${label}.publishedRevision`, 1)
  const publishedAt = schemaVersion < STORE_SCHEMA_VERSION
    ? updatedAt
    : optionalInteger(source['publishedAt'], `${label}.publishedAt`, createdAt)
  if ((publishedRevision === undefined) !== (publishedAt === undefined)) {
    invalid(`${label} must contain publishedRevision and publishedAt together`)
  }
  if (publishedRevision !== undefined && publishedRevision > revision) {
    invalid(`${label}.publishedRevision cannot exceed its head revision`)
  }
  return deepFreeze({
    ...draft,
    workspaceId: owner,
    revision,
    createdAt,
    updatedAt,
    ...(publishedRevision === undefined ? {} : { publishedRevision, publishedAt: publishedAt as number }),
  })
}

function decodeVersion(raw: unknown, limits: GraphWorkflowLimits, label: string): GraphWorkflowVersion {
  const source = recordOf(raw, label)
  const draft = normalizeWorkflowDraft(source as unknown as GraphWorkflowDraft, limits)
  return deepFreeze({
    ...draft,
    workspaceId: workspaceId(source['workspaceId'], `${label}.workspaceId`),
    revision: safeInteger(source['revision'], `${label}.revision`, 1),
    createdAt: safeInteger(source['createdAt'], `${label}.createdAt`, 0),
  })
}

function decodeFailure(raw: unknown, label: string): GraphWorkflowFailure | undefined {
  if (raw === undefined) return undefined
  const source = recordOf(raw, label)
  return deepFreeze({
    code: boundedString(source['code'], `${label}.code`, 200),
    message: boundedString(source['message'], `${label}.message`, 1_000),
    ...(source['nodeId'] === undefined ? {} : { nodeId: boundedString(source['nodeId'], `${label}.nodeId`, 48) }),
  })
}

function decodeEvidence(raw: unknown, label: string): GraphWorkflowAcceptanceEvidence {
  const source = recordOf(raw, label)
  if (!EVIDENCE_KINDS.has(String(source['kind']))) invalid(`${label}.kind is invalid`)
  if (typeof source['expected'] !== 'string' && typeof source['expected'] !== 'number') invalid(`${label}.expected is invalid`)
  if (typeof source['actual'] !== 'string' && typeof source['actual'] !== 'number') invalid(`${label}.actual is invalid`)
  if (typeof source['passed'] !== 'boolean') invalid(`${label}.passed must be boolean`)
  return deepFreeze({
    kind: source['kind'] as GraphWorkflowAcceptanceEvidence['kind'],
    expected: source['expected'],
    actual: source['actual'],
    passed: source['passed'],
    message: boundedString(source['message'], `${label}.message`, 500),
  })
}

function decodeNodeSnapshot(raw: unknown, label: string): GraphWorkflowNodeRunSnapshot {
  const source = recordOf(raw, label)
  const status = String(source['status'])
  if (!NODE_STATUSES.has(status)) invalid(`${label}.status is invalid`)
  const evidence = source['evidence'] === undefined
    ? undefined
    : Array.isArray(source['evidence'])
      ? source['evidence'].map((item, index) => decodeEvidence(item, `${label}.evidence[${String(index)}]`))
      : invalid(`${label}.evidence must be an array`)
  return deepFreeze({
    nodeId: boundedString(source['nodeId'], `${label}.nodeId`, 48),
    name: boundedString(source['name'], `${label}.name`, 100),
    status: status as GraphWorkflowNodeRunSnapshot['status'],
    ...(source['startedAt'] === undefined ? {} : { startedAt: safeInteger(source['startedAt'], `${label}.startedAt`, 0) }),
    ...(source['endedAt'] === undefined ? {} : { endedAt: safeInteger(source['endedAt'], `${label}.endedAt`, 0) }),
    ...(source['output'] === undefined ? {} : { output: boundedString(source['output'], `${label}.output`, 10_000_000) }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(source['error'] === undefined ? {} : { error: decodeFailure(source['error'], `${label}.error`) as GraphWorkflowFailure }),
  })
}

function decodeStringRecord(raw: unknown, label: string, maxChars: number): Readonly<Record<string, string>> {
  const source = recordOf(raw, label)
  const result: Record<string, string> = {}
  let chars = 0
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') invalid(`${label}.${key} must be a string`)
    chars += value.length
    if (chars > maxChars) invalid(`${label} exceeds ${String(maxChars)} characters`)
    result[key] = value
  }
  return deepFreeze(result)
}

function decodeRun(raw: unknown, limits: GraphWorkflowLimits, label: string): GraphWorkflowRunSnapshot {
  const source = recordOf(raw, label)
  const status = String(source['status'])
  if (!RUN_STATUSES.has(status)) invalid(`${label}.status must be settled`)
  if (!Array.isArray(source['nodes'])) invalid(`${label}.nodes must be an array`)
  const workflow = decodeDefinition(source['workflow'], STORE_SCHEMA_VERSION, limits, `${label}.workflow`)
  const nodes = source['nodes'].map((item, index) => decodeNodeSnapshot(item, `${label}.nodes[${String(index)}]`))
  if (new Set(nodes.map(node => node.nodeId)).size !== nodes.length
    || nodes.some(node => !workflow.nodes.some(candidate => candidate.id === node.nodeId))) {
    invalid(`${label}.nodes do not match its workflow snapshot`)
  }
  if (nodes.some(node => node.status === 'queued' || node.status === 'running')) invalid(`${label}.nodes must all be settled`)
  const owner = workspaceId(source['workspaceId'], `${label}.workspaceId`)
  if (workflow.workspaceId !== owner) invalid(`${label}.workflow belongs to another Workspace`)
  const workflowId = boundedString(source['workflowId'], `${label}.workflowId`, 64)
  const workflowRevision = safeInteger(source['workflowRevision'], `${label}.workflowRevision`, 1)
  if (workflow.id !== workflowId || workflow.revision !== workflowRevision) invalid(`${label}.workflow identity is inconsistent`)
  const deliverable = source['deliverable'] === undefined ? undefined : boundedString(source['deliverable'], `${label}.deliverable`, 10_000_000)
  const failure = decodeFailure(source['error'], `${label}.error`)
  if (status === 'succeeded' && (deliverable === undefined || failure !== undefined || nodes.some(node => node.status !== 'succeeded'))) {
    invalid(`${label} has an inconsistent succeeded outcome`)
  }
  if (status !== 'succeeded' && failure === undefined) invalid(`${label} is missing its settled failure`)
  return deepFreeze({
    runId: boundedString(source['runId'], `${label}.runId`, 200),
    workspaceId: owner,
    workflowId,
    workflowName: boundedString(source['workflowName'], `${label}.workflowName`, 100),
    workflowRevision,
    revision: safeInteger(source['revision'], `${label}.revision`, 1),
    status: status as GraphWorkflowRunSnapshot['status'],
    createdAt: safeInteger(source['createdAt'], `${label}.createdAt`, 0),
    ...(source['startedAt'] === undefined ? {} : { startedAt: safeInteger(source['startedAt'], `${label}.startedAt`, 0) }),
    endedAt: safeInteger(source['endedAt'], `${label}.endedAt`, 0),
    input: decodeStringRecord(source['input'], `${label}.input`, limits.maxInputChars),
    workflow,
    nodes,
    ...(deliverable === undefined ? {} : { deliverable }),
    ...(failure === undefined ? {} : { error: failure }),
    ...(source['targetNodeId'] === undefined ? {} : { targetNodeId: boundedString(source['targetNodeId'], `${label}.targetNodeId`, 48) }),
  })
}

function decodeTestCase(raw: unknown, limits: GraphWorkflowLimits, label: string): GraphWorkflowTestCase {
  const source = recordOf(raw, label)
  const id = boundedString(source['id'], `${label}.id`, 64)
  if (!TEST_CASE_ID.test(id)) invalid(`${label}.id must be lower-kebab-case`)
  const createdAt = safeInteger(source['createdAt'], `${label}.createdAt`, 0)
  const updatedAt = safeInteger(source['updatedAt'], `${label}.updatedAt`, createdAt)
  return deepFreeze({
    id,
    name: boundedString(source['name'], `${label}.name`, 100),
    workspaceId: workspaceId(source['workspaceId'], `${label}.workspaceId`),
    workflowId: boundedString(source['workflowId'], `${label}.workflowId`, 64),
    input: decodeStringRecord(source['input'], `${label}.input`, limits.maxInputChars),
    createdAt,
    updatedAt,
  })
}

function decodeDocument(value: unknown, limits: GraphWorkflowLimits): StoreDocument {
  const candidate = recordOf(value, 'graph workflow store root')
  const schemaVersion = candidate['schemaVersion']
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== STORE_SCHEMA_VERSION) {
    invalid(`unsupported graph workflow store schema ${String(schemaVersion)}`)
  }
  const revision = safeInteger(candidate['revision'], 'store.revision', 0)
  if (!Array.isArray(candidate['workflows']) || candidate['workflows'].length > limits.maxWorkflows) {
    invalid(`store.workflows must contain at most ${String(limits.maxWorkflows)} entries`)
  }
  const identities = new Set<string>()
  const workflows = candidate['workflows'].map((raw, index) => {
    const workflow = decodeDefinition(raw, schemaVersion, limits, `store.workflows[${String(index)}]`)
    const identity = `${workflow.workspaceId}\0${workflow.id}`
    if (identities.has(identity)) invalid(`store contains duplicate workflow "${workflow.id}" in Workspace "${workflow.workspaceId}"`)
    identities.add(identity)
    return workflow
  })

  let initializedWorkspaceIds: string[]
  if (schemaVersion >= 3) {
    if (!Array.isArray(candidate['initializedWorkspaceIds'])) invalid('store.initializedWorkspaceIds must be an array')
    initializedWorkspaceIds = candidate['initializedWorkspaceIds'].map((item, index) => workspaceId(
      item,
      `store.initializedWorkspaceIds[${String(index)}]`,
    ))
    if (new Set(initializedWorkspaceIds).size !== initializedWorkspaceIds.length) invalid('store.initializedWorkspaceIds contains duplicates')
  } else {
    initializedWorkspaceIds = [...new Set(workflows.map(workflow => workflow.workspaceId).filter(owner => owner !== LEGACY_WORKSPACE_ID))]
  }

  let versions: GraphWorkflowVersion[]
  let runs: GraphWorkflowRunSnapshot[]
  let testCases: GraphWorkflowTestCase[]
  if (schemaVersion === STORE_SCHEMA_VERSION) {
    if (!Array.isArray(candidate['versions']) || candidate['versions'].length > 100_000) invalid('store.versions must be a bounded array')
    versions = candidate['versions'].map((raw, index) => decodeVersion(raw, limits, `store.versions[${String(index)}]`))
    if (!Array.isArray(candidate['runs']) || candidate['runs'].length > 100_000) invalid('store.runs must be a bounded array')
    runs = candidate['runs'].map((raw, index) => decodeRun(raw, limits, `store.runs[${String(index)}]`))
    if (!Array.isArray(candidate['testCases']) || candidate['testCases'].length > 100_000) invalid('store.testCases must be a bounded array')
    testCases = candidate['testCases'].map((raw, index) => decodeTestCase(raw, limits, `store.testCases[${String(index)}]`))
  } else {
    versions = workflows.map(workflow => deepFreeze({
      ...normalizeWorkflowDraft(workflow, limits),
      workspaceId: workflow.workspaceId,
      revision: workflow.revision,
      createdAt: workflow.updatedAt,
    }))
    runs = []
    testCases = []
  }

  const versionIds = new Set<string>()
  for (const version of versions) {
    const identity = `${version.workspaceId}\0${version.id}\0${String(version.revision)}`
    if (versionIds.has(identity)) invalid(`store contains duplicate version ${identity}`)
    versionIds.add(identity)
  }
  for (const workflow of workflows) {
    if (!versionIds.has(`${workflow.workspaceId}\0${workflow.id}\0${String(workflow.revision)}`)) invalid(`workflow "${workflow.id}" is missing its head version`)
    if (workflow.publishedRevision !== undefined
      && !versionIds.has(`${workflow.workspaceId}\0${workflow.id}\0${String(workflow.publishedRevision)}`)) {
      invalid(`workflow "${workflow.id}" is missing its published version`)
    }
  }
  for (const version of versions) {
    if (!identities.has(`${version.workspaceId}\0${version.id}`)) invalid(`version r${String(version.revision)} for "${version.id}" has no workflow head`)
  }
  if (new Set(runs.map(run => `${run.workspaceId}\0${run.runId}`)).size !== runs.length) invalid('store.runs contains duplicate run ids')
  if (new Set(testCases.map(item => `${item.workspaceId}\0${item.workflowId}\0${item.id}`)).size !== testCases.length) {
    invalid('store.testCases contains duplicate ids')
  }
  if (testCases.some(item => !identities.has(`${item.workspaceId}\0${item.workflowId}`))) invalid('store.testCases contains an orphaned workflow id')
  return deepFreeze({
    schemaVersion: STORE_SCHEMA_VERSION,
    revision,
    workflows,
    versions,
    runs,
    testCases,
    initializedWorkspaceIds: initializedWorkspaceIds.sort(),
  })
}

function versionFromDefinition(definition: GraphWorkflowDefinition, limits: GraphWorkflowLimits): GraphWorkflowVersion {
  return deepFreeze({
    ...normalizeWorkflowDraft(definition, limits),
    workspaceId: definition.workspaceId,
    revision: definition.revision,
    createdAt: definition.updatedAt,
  })
}

/** Versioned atomic JSON store for definitions, history, test cases, and settled runs. */
export class GraphWorkflowStore {
  private document: StoreDocument
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    readonly path: string,
    private readonly limits: GraphWorkflowLimits,
    document: StoreDocument,
  ) {
    this.document = document
  }

  static async open(path: string, limits: GraphWorkflowLimits): Promise<GraphWorkflowStore> {
    if (typeof path !== 'string' || path.trim().length === 0) invalid('storageFile must be a non-empty path')
    let document = emptyDocument()
    try {
      const source = await readFile(path, 'utf8')
      document = decodeDocument(JSON.parse(source) as unknown, limits)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        if (error instanceof GraphWorkflowError) throw error
        throw new GraphWorkflowError(
          `cannot read graph workflow store: ${error instanceof Error ? error.message : String(error)}`,
          'GRAPH_WORKFLOW_STORE_INVALID',
          { cause: error },
        )
      }
    }
    return new GraphWorkflowStore(path, limits, document)
  }

  catalog(owner: string): GraphWorkflowCatalog {
    return deepFreeze({
      workspaceId: owner,
      revision: this.document.revision,
      workflows: this.document.workflows.filter(workflow => workflow.workspaceId === owner).sort((left, right) => left.id.localeCompare(right.id)),
    })
  }

  /** Catalog projected to the exact content of each published revision. */
  publishedCatalog(owner: string): GraphWorkflowCatalog {
    const workflows = this.document.workflows.flatMap((head): GraphWorkflowDefinition[] => {
      if (head.workspaceId !== owner || head.publishedRevision === undefined) return []
      const version = this.version(owner, head.id, head.publishedRevision)
      if (version === undefined) return []
      return [deepFreeze({
        ...version,
        workspaceId: owner,
        createdAt: head.createdAt,
        updatedAt: version.createdAt,
        publishedRevision: head.publishedRevision,
        publishedAt: head.publishedAt as number,
      })]
    })
    return deepFreeze({ workspaceId: owner, revision: this.document.revision, workflows: workflows.sort((a, b) => a.id.localeCompare(b.id)) })
  }

  get(owner: string, id: string): GraphWorkflowDefinition | undefined {
    const found = this.document.workflows.find(workflow => workflow.workspaceId === owner && workflow.id === id)
    return found === undefined ? undefined : deepFreeze(found)
  }

  version(owner: string, id: string, revision: number): GraphWorkflowVersion | undefined {
    const found = this.document.versions.find(item => item.workspaceId === owner && item.id === id && item.revision === revision)
    return found === undefined ? undefined : deepFreeze(found)
  }

  versions(owner: string, id: string): GraphWorkflowVersionCatalog {
    const head = this.get(owner, id)
    if (head === undefined) throw new GraphWorkflowError(`workflow "${id}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
    return deepFreeze({
      workspaceId: owner,
      workflowId: id,
      ...(head.publishedRevision === undefined ? {} : { publishedRevision: head.publishedRevision }),
      versions: this.document.versions.filter(version => version.workspaceId === owner && version.id === id).sort((left, right) => right.revision - left.revision),
    })
  }

  /** Resolve either an explicitly pinned saved revision or the production publication. */
  executionDefinition(owner: string, id: string, revision?: number): GraphWorkflowDefinition {
    const head = this.get(owner, id)
    if (head === undefined) throw new GraphWorkflowError(`workflow "${id}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
    const selectedRevision = revision ?? head.publishedRevision
    if (selectedRevision === undefined) throw new GraphWorkflowError(`workflow "${id}" has not been published`, 'GRAPH_WORKFLOW_NOT_PUBLISHED')
    const version = this.version(owner, id, selectedRevision)
    if (version === undefined) {
      throw new GraphWorkflowError(`workflow "${id}" revision ${String(selectedRevision)} was not found`, 'GRAPH_WORKFLOW_VERSION_NOT_FOUND')
    }
    return deepFreeze({
      ...version,
      workspaceId: owner,
      createdAt: head.createdAt,
      updatedAt: version.createdAt,
      // Publication metadata belongs to the selected immutable content only
      // when that exact revision is the production projection. In particular,
      // an explicitly executed older revision must not claim a newer published
      // revision that its self-contained run snapshot cannot reference.
      ...(head.publishedRevision !== selectedRevision ? {} : {
        publishedRevision: selectedRevision,
        publishedAt: head.publishedAt as number,
      }),
    })
  }

  runs(owner: string): readonly GraphWorkflowRunSnapshot[] {
    return deepFreeze(this.document.runs.filter(run => run.workspaceId === owner).sort((left, right) => right.createdAt - left.createdAt))
  }

  testCases(owner: string, workflowId: string): GraphWorkflowTestCaseCatalog {
    return deepFreeze({
      workspaceId: owner,
      workflowId,
      testCases: this.document.testCases
        .filter(item => item.workspaceId === owner && item.workflowId === workflowId)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    })
  }

  adoptLegacy(owner: string): Promise<void> {
    return this.enqueue(async () => {
      const legacy = this.document.workflows.filter(workflow => workflow.workspaceId === LEGACY_WORKSPACE_ID)
      if (legacy.length === 0) return
      const scoped = this.document.workflows.filter(workflow => workflow.workspaceId !== LEGACY_WORKSPACE_ID)
      const existing = new Set(scoped.filter(workflow => workflow.workspaceId === owner).map(workflow => workflow.id))
      const adoptedIds = new Set(legacy.filter(workflow => !existing.has(workflow.id)).map(workflow => workflow.id))
      const workflows = [...scoped, ...legacy.filter(workflow => adoptedIds.has(workflow.id)).map(workflow => deepFreeze({ ...workflow, workspaceId: owner }))]
      const versions = [
        ...this.document.versions.filter(version => version.workspaceId !== LEGACY_WORKSPACE_ID),
        ...this.document.versions
          .filter(version => version.workspaceId === LEGACY_WORKSPACE_ID && adoptedIds.has(version.id))
          .map(version => deepFreeze({ ...version, workspaceId: owner })),
      ]
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows,
        versions,
        initializedWorkspaceIds: [...new Set([...this.document.initializedWorkspaceIds, owner])].sort(),
      })
      await this.persist(next)
      this.document = next
    })
  }

  save(owner: string, request: SaveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const draft = normalizeWorkflowDraft(request.workflow, this.limits)
      const current = this.document.workflows.find(workflow => workflow.workspaceId === owner && workflow.id === draft.id)
      if (current === undefined) {
        if (request.expectedRevision !== undefined && request.expectedRevision !== 0) {
          throw new GraphWorkflowError(`workflow "${draft.id}" does not exist at expected revision ${String(request.expectedRevision)}`, 'GRAPH_WORKFLOW_CONFLICT')
        }
        if (this.document.workflows.length >= this.limits.maxWorkflows) {
          throw new GraphWorkflowError(`workflow catalog reached maxWorkflows (${String(this.limits.maxWorkflows)})`, 'GRAPH_WORKFLOW_INVALID')
        }
      } else if (request.expectedRevision !== current.revision) {
        throw new GraphWorkflowError(`stale workflow "${draft.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`, 'GRAPH_WORKFLOW_CONFLICT')
      }
      const now = Math.max(Date.now(), current?.createdAt ?? 0, current?.updatedAt ?? 0)
      const saved: GraphWorkflowDefinition = deepFreeze({
        ...draft,
        workspaceId: owner,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        ...(current?.publishedRevision === undefined ? {} : { publishedRevision: current.publishedRevision, publishedAt: current.publishedAt as number }),
      })
      const workflows = this.document.workflows.filter(workflow => workflow.workspaceId !== owner || workflow.id !== draft.id)
      workflows.push(saved)
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows,
        versions: [...this.document.versions, versionFromDefinition(saved, this.limits)],
        initializedWorkspaceIds: [...new Set([...this.document.initializedWorkspaceIds, owner])].sort(),
      })
      await this.persist(next)
      this.document = next
      return deepFreeze(saved)
    })
  }

  publish(owner: string, request: PublishGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const current = this.document.workflows.find(item => item.workspaceId === owner && item.id === request.workflowId)
      if (current === undefined) throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      if (current.revision !== request.expectedRevision) {
        throw new GraphWorkflowError(`stale workflow "${current.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`, 'GRAPH_WORKFLOW_CONFLICT')
      }
      if (current.publishedRevision !== request.expectedPublishedRevision) {
        throw new GraphWorkflowError(
          `stale publication for workflow "${current.id}"; published revision is ${String(current.publishedRevision)}`,
          'GRAPH_WORKFLOW_CONFLICT',
        )
      }
      if (this.version(owner, current.id, request.revision) === undefined) {
        throw new GraphWorkflowError(`workflow "${current.id}" revision ${String(request.revision)} was not found`, 'GRAPH_WORKFLOW_VERSION_NOT_FOUND')
      }
      const published: GraphWorkflowDefinition = deepFreeze({
        ...current,
        publishedRevision: request.revision,
        publishedAt: Math.max(Date.now(), current.createdAt, current.publishedAt ?? 0),
      })
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows: this.document.workflows.map(item => item.workspaceId === owner && item.id === current.id ? published : item),
      })
      await this.persist(next)
      this.document = next
      return published
    })
  }

  restore(owner: string, request: RestoreGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const current = this.document.workflows.find(item => item.workspaceId === owner && item.id === request.workflowId)
      if (current === undefined) throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      if (current.revision !== request.expectedRevision) {
        throw new GraphWorkflowError(`stale workflow "${current.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`, 'GRAPH_WORKFLOW_CONFLICT')
      }
      const source = this.version(owner, current.id, request.revision)
      if (source === undefined) {
        throw new GraphWorkflowError(`workflow "${current.id}" revision ${String(request.revision)} was not found`, 'GRAPH_WORKFLOW_VERSION_NOT_FOUND')
      }
      const now = Math.max(Date.now(), current.updatedAt)
      const restored: GraphWorkflowDefinition = deepFreeze({
        ...normalizeWorkflowDraft(source, this.limits),
        workspaceId: owner,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: now,
        ...(current.publishedRevision === undefined ? {} : { publishedRevision: current.publishedRevision, publishedAt: current.publishedAt as number }),
      })
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows: this.document.workflows.map(item => item.workspaceId === owner && item.id === current.id ? restored : item),
        versions: [...this.document.versions, versionFromDefinition(restored, this.limits)],
      })
      await this.persist(next)
      this.document = next
      return restored
    })
  }

  remove(owner: string, request: RemoveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const current = this.document.workflows.find(workflow => workflow.workspaceId === owner && workflow.id === request.workflowId)
      if (current === undefined) throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      if (request.expectedRevision !== current.revision) {
        throw new GraphWorkflowError(`stale workflow "${current.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`, 'GRAPH_WORKFLOW_CONFLICT')
      }
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows: this.document.workflows.filter(workflow => workflow.workspaceId !== owner || workflow.id !== current.id),
        versions: this.document.versions.filter(version => version.workspaceId !== owner || version.id !== current.id),
        testCases: this.document.testCases.filter(item => item.workspaceId !== owner || item.workflowId !== current.id),
      })
      await this.persist(next)
      this.document = next
      return deepFreeze(current)
    })
  }

  recordRun(owner: string, snapshot: GraphWorkflowRunSnapshot, retainedRuns: number): Promise<void> {
    return this.enqueue(async () => {
      if (!RUN_STATUSES.has(snapshot.status) || snapshot.endedAt === undefined || snapshot.workspaceId !== owner) {
        throw new GraphWorkflowError('only settled runs owned by the Workspace can be persisted', 'GRAPH_WORKFLOW_STORE_INVALID')
      }
      const others = this.document.runs.filter(run => run.workspaceId !== owner)
      const owned = [
        ...this.document.runs.filter(run => run.workspaceId === owner && run.runId !== snapshot.runId),
        deepFreeze(snapshot),
      ].sort((left, right) => right.createdAt - left.createdAt).slice(0, retainedRuns)
      const next: StoreDocument = deepFreeze({ ...this.document, revision: this.document.revision + 1, runs: [...others, ...owned] })
      await this.persist(next)
      this.document = next
    })
  }

  saveTestCase(owner: string, workflowId: string, draft: GraphWorkflowTestCaseDraft): Promise<GraphWorkflowTestCase> {
    return this.enqueue(async () => {
      const workflow = this.document.workflows.find(item => item.workspaceId === owner && item.id === workflowId)
      if (workflow === undefined) throw new GraphWorkflowError(`workflow "${workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      const id = draft.id.trim()
      if (!TEST_CASE_ID.test(id) || id.length > 64) throw new GraphWorkflowError('testCase.id must be lower-kebab-case', 'GRAPH_WORKFLOW_INVALID')
      const name = draft.name.trim()
      if (name.length === 0 || name.length > 100) throw new GraphWorkflowError('testCase.name must be 1-100 characters', 'GRAPH_WORKFLOW_INVALID')
      const input = normalizeRunInput(workflow, draft.input, this.limits.maxInputChars)
      const current = this.document.testCases.find(item => item.workspaceId === owner && item.workflowId === workflowId && item.id === id)
      const now = Math.max(Date.now(), current?.updatedAt ?? 0)
      const saved: GraphWorkflowTestCase = deepFreeze({
        id,
        name,
        input,
        workspaceId: owner,
        workflowId,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      })
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        testCases: [...this.document.testCases.filter(item => item.workspaceId !== owner || item.workflowId !== workflowId || item.id !== id), saved],
      })
      await this.persist(next)
      this.document = next
      return saved
    })
  }

  removeTestCase(owner: string, workflowId: string, testCaseId: string): Promise<GraphWorkflowTestCase> {
    return this.enqueue(async () => {
      const current = this.document.testCases.find(item => item.workspaceId === owner && item.workflowId === workflowId && item.id === testCaseId)
      if (current === undefined) throw new GraphWorkflowError(`test case "${testCaseId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        testCases: this.document.testCases.filter(item => item !== current),
      })
      await this.persist(next)
      this.document = next
      return current
    })
  }

  async drain(): Promise<void> {
    await this.queue
  }

  initializeWorkspace(owner: string, starter?: GraphWorkflowDraft): Promise<GraphWorkflowDefinition | undefined> {
    return this.enqueue(async () => {
      const normalizedOwner = workspaceId(owner, 'workspaceId')
      if (this.document.initializedWorkspaceIds.includes(normalizedOwner)) return undefined
      let seeded: GraphWorkflowDefinition | undefined
      const workflows = [...this.document.workflows]
      const versions = [...this.document.versions]
      if (starter !== undefined && !workflows.some(workflow => workflow.workspaceId === normalizedOwner)) {
        if (workflows.length >= this.limits.maxWorkflows) {
          throw new GraphWorkflowError(`workflow catalog reached maxWorkflows (${String(this.limits.maxWorkflows)})`, 'GRAPH_WORKFLOW_INVALID')
        }
        const draft = normalizeWorkflowDraft(starter, this.limits)
        const now = Date.now()
        seeded = deepFreeze({
          ...draft,
          workspaceId: normalizedOwner,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          publishedRevision: 1,
          publishedAt: now,
        })
        workflows.push(seeded)
        versions.push(versionFromDefinition(seeded, this.limits))
      }
      const next: StoreDocument = deepFreeze({
        ...this.document,
        revision: this.document.revision + 1,
        workflows,
        versions,
        initializedWorkspaceIds: [...this.document.initializedWorkspaceIds, normalizedOwner].sort(),
      })
      await this.persist(next)
      this.document = next
      return seeded === undefined ? undefined : deepFreeze(seeded)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(document: StoreDocument): Promise<void> {
    const directory = dirname(this.path)
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
    try {
      await mkdir(directory, { recursive: true })
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw new GraphWorkflowError(
        `cannot commit graph workflow store: ${error instanceof Error ? error.message : String(error)}`,
        'GRAPH_WORKFLOW_STORE_WRITE_FAILED',
        { cause: error },
      )
    }
  }
}

export async function seedWorkflow(
  store: GraphWorkflowStore,
  workspaceId: string,
  workflow: GraphWorkflowDraft,
): Promise<GraphWorkflowDefinition | undefined> {
  return await store.initializeWorkspace(workspaceId, workflow)
}
