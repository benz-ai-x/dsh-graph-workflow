import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowDraft,
  GraphWorkflowLimits,
  RemoveGraphWorkflowRequest,
  SaveGraphWorkflowRequest,
} from './domain.ts'
import { deepFreeze, normalizeWorkflowDraft } from './domain.ts'
import { GraphWorkflowError } from './errors.ts'

const STORE_SCHEMA_VERSION = 1

interface StoreDocument {
  readonly schemaVersion: 1
  readonly revision: number
  readonly workflows: readonly GraphWorkflowDefinition[]
}

function emptyDocument(): StoreDocument {
  return deepFreeze({ schemaVersion: STORE_SCHEMA_VERSION, revision: 0, workflows: [] })
}

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new GraphWorkflowError(`${label} must be a safe integer >= ${String(minimum)}`, 'GRAPH_WORKFLOW_STORE_INVALID')
  }
  return value as number
}

function decodeDocument(value: unknown, limits: GraphWorkflowLimits): StoreDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GraphWorkflowError('graph workflow store root must be an object', 'GRAPH_WORKFLOW_STORE_INVALID')
  }
  const candidate = value as Record<string, unknown>
  if (candidate['schemaVersion'] !== STORE_SCHEMA_VERSION) {
    throw new GraphWorkflowError(
      `unsupported graph workflow store schema ${String(candidate['schemaVersion'])}`,
      'GRAPH_WORKFLOW_STORE_INVALID',
    )
  }
  const revision = safeInteger(candidate['revision'], 'store.revision', 0)
  if (!Array.isArray(candidate['workflows']) || candidate['workflows'].length > limits.maxWorkflows) {
    throw new GraphWorkflowError(
      `store.workflows must contain at most ${String(limits.maxWorkflows)} entries`,
      'GRAPH_WORKFLOW_STORE_INVALID',
    )
  }
  const ids = new Set<string>()
  const workflows = candidate['workflows'].map((raw, index): GraphWorkflowDefinition => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new GraphWorkflowError(`store.workflows[${String(index)}] must be an object`, 'GRAPH_WORKFLOW_STORE_INVALID')
    }
    const stored = raw as GraphWorkflowDefinition
    const draft = normalizeWorkflowDraft(stored, limits)
    if (ids.has(draft.id)) {
      throw new GraphWorkflowError(`store contains duplicate workflow "${draft.id}"`, 'GRAPH_WORKFLOW_STORE_INVALID')
    }
    ids.add(draft.id)
    const workflowRevision = safeInteger(stored.revision, `workflow "${draft.id}" revision`, 1)
    const createdAt = safeInteger(stored.createdAt, `workflow "${draft.id}" createdAt`, 0)
    const updatedAt = safeInteger(stored.updatedAt, `workflow "${draft.id}" updatedAt`, createdAt)
    if (updatedAt < createdAt) {
      throw new GraphWorkflowError(`workflow "${draft.id}" updatedAt precedes createdAt`, 'GRAPH_WORKFLOW_STORE_INVALID')
    }
    return deepFreeze({ ...draft, revision: workflowRevision, createdAt, updatedAt })
  })
  return deepFreeze({ schemaVersion: STORE_SCHEMA_VERSION, revision, workflows })
}

/** Versioned atomic JSON store for reusable workflow definitions. */
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

  /** Open and validate the complete document before publishing a service. */
  static async open(path: string, limits: GraphWorkflowLimits): Promise<GraphWorkflowStore> {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new GraphWorkflowError('storageFile must be a non-empty path', 'GRAPH_WORKFLOW_STORE_INVALID')
    }
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

  /** Return a detached immutable catalog sorted by workflow id. */
  catalog(): GraphWorkflowCatalog {
    return deepFreeze({
      revision: this.document.revision,
      workflows: [...this.document.workflows].sort((left, right) => left.id.localeCompare(right.id)),
    })
  }

  /** Read one detached immutable definition. */
  get(id: string): GraphWorkflowDefinition | undefined {
    const found = this.document.workflows.find(workflow => workflow.id === id)
    return found === undefined ? undefined : deepFreeze(found)
  }

  /** Persist one CAS-protected whole definition, then publish it in memory. */
  save(request: SaveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const draft = normalizeWorkflowDraft(request.workflow, this.limits)
      const current = this.document.workflows.find(workflow => workflow.id === draft.id)
      if (current === undefined) {
        if (request.expectedRevision !== undefined && request.expectedRevision !== 0) {
          throw new GraphWorkflowError(
            `workflow "${draft.id}" does not exist at expected revision ${String(request.expectedRevision)}`,
            'GRAPH_WORKFLOW_CONFLICT',
          )
        }
        if (this.document.workflows.length >= this.limits.maxWorkflows) {
          throw new GraphWorkflowError(
            `workflow catalog reached maxWorkflows (${String(this.limits.maxWorkflows)})`,
            'GRAPH_WORKFLOW_INVALID',
          )
        }
      } else if (request.expectedRevision !== current.revision) {
        throw new GraphWorkflowError(
          `stale workflow "${draft.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`,
          'GRAPH_WORKFLOW_CONFLICT',
        )
      }
      const now = Math.max(Date.now(), current?.createdAt ?? 0, current?.updatedAt ?? 0)
      const saved: GraphWorkflowDefinition = deepFreeze({
        ...draft,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      })
      const workflows = this.document.workflows.filter(workflow => workflow.id !== draft.id)
      workflows.push(saved)
      const next: StoreDocument = deepFreeze({
        schemaVersion: STORE_SCHEMA_VERSION,
        revision: this.document.revision + 1,
        workflows,
      })
      await this.persist(next)
      this.document = next
      return deepFreeze(saved)
    })
  }

  /** Persist a CAS-protected deletion before removing it from the live catalog. */
  remove(request: RemoveGraphWorkflowRequest): Promise<GraphWorkflowDefinition> {
    return this.enqueue(async () => {
      const current = this.document.workflows.find(workflow => workflow.id === request.workflowId)
      if (current === undefined) {
        throw new GraphWorkflowError(`workflow "${request.workflowId}" was not found`, 'GRAPH_WORKFLOW_NOT_FOUND')
      }
      if (request.expectedRevision !== current.revision) {
        throw new GraphWorkflowError(
          `stale workflow "${current.id}" revision ${String(request.expectedRevision)}; current revision is ${String(current.revision)}`,
          'GRAPH_WORKFLOW_CONFLICT',
        )
      }
      const next: StoreDocument = deepFreeze({
        schemaVersion: STORE_SCHEMA_VERSION,
        revision: this.document.revision + 1,
        workflows: this.document.workflows.filter(workflow => workflow.id !== current.id),
      })
      await this.persist(next)
      this.document = next
      return deepFreeze(current)
    })
  }

  /** Wait for all admitted commits to settle. */
  async drain(): Promise<void> {
    await this.queue
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

/** Helper for seeding a starter workflow only when the catalog is empty. */
export async function seedWorkflow(
  store: GraphWorkflowStore,
  workflow: GraphWorkflowDraft,
): Promise<GraphWorkflowDefinition | undefined> {
  if (store.catalog().workflows.length > 0) return undefined
  return await store.save({ workflow, expectedRevision: 0 })
}
