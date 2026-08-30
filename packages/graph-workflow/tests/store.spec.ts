import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphWorkflowDraft, GraphWorkflowRunSnapshot } from '../src/domain.ts'
import { GraphWorkflowStore } from '../src/store.ts'

const directories: string[] = []
const limits = { maxWorkflows: 4, maxNodesPerWorkflow: 8, maxInputChars: 1_000, maxPromptChars: 2_000 }

function workflow(id = 'persisted-flow'): GraphWorkflowDraft {
  return {
    id,
    name: 'Persisted flow',
    description: 'Proves the external JSON boundary.',
    inputs: [{ key: 'brief', label: 'Brief', required: true }],
    nodes: [{ id: 'deliver', name: 'Deliver', dependsOn: [], prompt: '{{input.brief}}' }],
    outputNode: 'deliver',
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('GraphWorkflowStore', () => {
  it('commits a versioned external JSON file and reopens the same definition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-store-'))
    directories.push(directory)
    const path = join(directory, 'nested', 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    const saved = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    expect(saved.revision).toBe(1)
    expect(saved.workspaceId).toBe('workspace-a')

    // External-world assertion: success is backed by the actual committed file,
    // not only by the service's in-memory self-report.
    const disk = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; revision: number; workflows: unknown[] }
    expect(disk).toMatchObject({ schemaVersion: 4, revision: 1 })
    expect(disk.workflows).toHaveLength(1)

    const reopened = await GraphWorkflowStore.open(path, limits)
    expect(reopened.get('workspace-a', 'persisted-flow')).toEqual(saved)
  })

  it('serializes concurrent CAS writes so exactly one stale writer wins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-cas-'))
    directories.push(directory)
    const store = await GraphWorkflowStore.open(join(directory, 'workflows.json'), limits)
    const first = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    const attempts = await Promise.allSettled([
      store.save('workspace-a', { workflow: { ...workflow(), name: 'Writer A' }, expectedRevision: first.revision }),
      store.save('workspace-a', { workflow: { ...workflow(), name: 'Writer B' }, expectedRevision: first.revision }),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({ code: 'GRAPH_WORKFLOW_CONFLICT' })
    expect(store.get('workspace-a', 'persisted-flow')?.revision).toBe(2)
  })

  it('keeps persisted timestamps valid when the system clock moves backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-clock-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    vi.setSystemTime(2_000)
    const first = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    vi.setSystemTime(1_000)
    const second = await store.save('workspace-a', { workflow: { ...workflow(), name: 'Clock safe' }, expectedRevision: first.revision })
    expect(second.updatedAt).toBe(first.updatedAt)
    await expect(GraphWorkflowStore.open(path, limits)).resolves.toBeInstanceOf(GraphWorkflowStore)
  })

  it('fails loud on malformed or unsupported persisted state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-invalid-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    await import('node:fs/promises').then(fs => fs.writeFile(path, '{"schemaVersion":99,"revision":0,"workflows":[]}'))
    await expect(GraphWorkflowStore.open(path, limits)).rejects.toMatchObject({ code: 'GRAPH_WORKFLOW_STORE_INVALID' })
  })

  it('allows the same workflow id in different Workspaces and keeps catalogs isolated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-scope-'))
    directories.push(directory)
    const store = await GraphWorkflowStore.open(join(directory, 'workflows.json'), limits)
    await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    await store.save('workspace-b', { workflow: { ...workflow(), name: 'Workspace B flow' }, expectedRevision: 0 })

    expect(store.catalog('workspace-a').workflows.map(item => item.name)).toEqual(['Persisted flow'])
    expect(store.catalog('workspace-b').workflows.map(item => item.name)).toEqual(['Workspace B flow'])
  })

  it('initializes a Workspace seed exactly once and does not resurrect it after deletion or restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-seed-once-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)

    await expect(store.initializeWorkspace('workspace-a', workflow('starter')))
      .resolves.toMatchObject({ id: 'starter', revision: 1 })
    await store.remove('workspace-a', { workflowId: 'starter', expectedRevision: 1 })
    await expect(store.initializeWorkspace('workspace-a', workflow('starter'))).resolves.toBeUndefined()
    expect(store.catalog('workspace-a').workflows).toEqual([])

    const reopened = await GraphWorkflowStore.open(path, limits)
    await expect(reopened.initializeWorkspace('workspace-a', workflow('starter'))).resolves.toBeUndefined()
    expect(reopened.catalog('workspace-a').workflows).toEqual([])
  })

  it('retains immutable versions, separates publication, and restores history as a new revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-versions-'))
    directories.push(directory)
    const store = await GraphWorkflowStore.open(join(directory, 'workflows.json'), limits)
    const first = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    expect(first.publishedRevision).toBeUndefined()
    expect(store.publishedCatalog('workspace-a').workflows).toEqual([])

    const second = await store.save('workspace-a', {
      workflow: { ...workflow(), name: 'Unpublished draft' },
      expectedRevision: first.revision,
    })
    expect(store.versions('workspace-a', first.id).versions.map(version => version.revision)).toEqual([2, 1])
    const published = await store.publish('workspace-a', {
      workflowId: first.id,
      revision: first.revision,
      expectedRevision: second.revision,
    })
    expect(published.publishedRevision).toBe(1)
    expect(store.publishedCatalog('workspace-a').workflows[0]).toMatchObject({ revision: 1, name: 'Persisted flow' })
    await expect(store.publish('workspace-a', {
      workflowId: first.id,
      revision: second.revision,
      expectedRevision: second.revision,
    })).rejects.toMatchObject({ code: 'GRAPH_WORKFLOW_CONFLICT' })

    const restored = await store.restore('workspace-a', {
      workflowId: first.id,
      revision: first.revision,
      expectedRevision: second.revision,
    })
    expect(restored).toMatchObject({ revision: 3, name: 'Persisted flow', publishedRevision: 1 })
    expect(store.versions('workspace-a', first.id).versions.map(version => version.revision)).toEqual([3, 2, 1])
  })

  it('persists an explicitly executed historical revision after a newer revision is published', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-historical-run-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    const first = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    const second = await store.save('workspace-a', {
      workflow: { ...workflow(), name: 'Production revision' },
      expectedRevision: first.revision,
    })
    await store.publish('workspace-a', {
      workflowId: first.id,
      revision: second.revision,
      expectedRevision: second.revision,
    })

    const historical = store.executionDefinition('workspace-a', first.id, first.revision)
    expect(historical).toMatchObject({ revision: 1, name: 'Persisted flow' })
    expect(historical.publishedRevision).toBeUndefined()
    const run: GraphWorkflowRunSnapshot = {
      runId: 'historical-run-1',
      workspaceId: 'workspace-a',
      workflowId: historical.id,
      workflowName: historical.name,
      workflowRevision: historical.revision,
      revision: 2,
      status: 'succeeded',
      createdAt: 100,
      startedAt: 101,
      endedAt: 110,
      input: { brief: 'historical' },
      workflow: historical,
      nodes: [{ nodeId: 'deliver', name: 'Deliver', status: 'succeeded', output: 'historical' }],
      deliverable: 'historical',
    }
    await store.recordRun('workspace-a', run, 10)

    const reopened = await GraphWorkflowStore.open(path, limits)
    expect(reopened.runs('workspace-a')).toEqual([run])
  })

  it('persists settled run evidence and reusable regression inputs across reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-history-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    const saved = await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    const published = await store.publish('workspace-a', {
      workflowId: saved.id,
      revision: 1,
      expectedRevision: 1,
    })
    await store.saveTestCase('workspace-a', saved.id, { id: 'happy-path', name: 'Happy path', input: { brief: 'launch' } })
    const run: GraphWorkflowRunSnapshot = {
      runId: 'durable-run-1',
      workspaceId: 'workspace-a',
      workflowId: saved.id,
      workflowName: saved.name,
      workflowRevision: 1,
      revision: 2,
      status: 'succeeded',
      createdAt: 100,
      startedAt: 101,
      endedAt: 110,
      input: { brief: 'launch' },
      workflow: published,
      nodes: [{
        nodeId: 'deliver',
        name: 'Deliver',
        status: 'succeeded',
        startedAt: 101,
        endedAt: 110,
        output: 'launch',
        evidence: [{ kind: 'minChars', expected: 1, actual: 6, passed: true, message: 'passed' }],
      }],
      deliverable: 'launch',
    }
    await store.recordRun('workspace-a', run, 10)

    const reopened = await GraphWorkflowStore.open(path, limits)
    expect(reopened.runs('workspace-a')).toEqual([run])
    expect(reopened.testCases('workspace-a', saved.id).testCases).toEqual([
      expect.objectContaining({ id: 'happy-path', input: { brief: 'launch' } }),
    ])
  })

  it('migrates schema-v3 heads into published immutable versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-v3-migration-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    await store.save('workspace-a', { workflow: workflow(), expectedRevision: 0 })
    const document = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    document['schemaVersion'] = 3
    delete document['versions']
    delete document['runs']
    delete document['testCases']
    for (const raw of document['workflows'] as Array<Record<string, unknown>>) {
      delete raw['publishedRevision']
      delete raw['publishedAt']
    }
    await writeFile(path, JSON.stringify(document), 'utf8')

    const migrated = await GraphWorkflowStore.open(path, limits)
    expect(migrated.versions('workspace-a', 'persisted-flow')).toMatchObject({ publishedRevision: 1 })
    expect(migrated.publishedCatalog('workspace-a').workflows[0]).toMatchObject({ id: 'persisted-flow', revision: 1 })
  })
})
