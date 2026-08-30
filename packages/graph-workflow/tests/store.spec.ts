import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphWorkflowDraft } from '../src/domain.ts'
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
    const saved = await store.save({ workflow: workflow(), expectedRevision: 0 })
    expect(saved.revision).toBe(1)

    // External-world assertion: success is backed by the actual committed file,
    // not only by the service's in-memory self-report.
    const disk = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; revision: number; workflows: unknown[] }
    expect(disk).toMatchObject({ schemaVersion: 1, revision: 1 })
    expect(disk.workflows).toHaveLength(1)

    const reopened = await GraphWorkflowStore.open(path, limits)
    expect(reopened.get('persisted-flow')).toEqual(saved)
  })

  it('serializes concurrent CAS writes so exactly one stale writer wins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-cas-'))
    directories.push(directory)
    const store = await GraphWorkflowStore.open(join(directory, 'workflows.json'), limits)
    const first = await store.save({ workflow: workflow(), expectedRevision: 0 })
    const attempts = await Promise.allSettled([
      store.save({ workflow: { ...workflow(), name: 'Writer A' }, expectedRevision: first.revision }),
      store.save({ workflow: { ...workflow(), name: 'Writer B' }, expectedRevision: first.revision }),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({ code: 'GRAPH_WORKFLOW_CONFLICT' })
    expect(store.get('persisted-flow')?.revision).toBe(2)
  })

  it('keeps persisted timestamps valid when the system clock moves backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-clock-'))
    directories.push(directory)
    const path = join(directory, 'workflows.json')
    const store = await GraphWorkflowStore.open(path, limits)
    vi.setSystemTime(2_000)
    const first = await store.save({ workflow: workflow(), expectedRevision: 0 })
    vi.setSystemTime(1_000)
    const second = await store.save({ workflow: { ...workflow(), name: 'Clock safe' }, expectedRevision: first.revision })
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
})
