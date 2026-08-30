// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/src/client/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { GraphWorkflowStudioInjected } from '../src/client/GraphWorkflowStudio.tsx'
import { WorkspaceGraphWorkflowSection } from '../src/client/WorkspaceGraphWorkflowSection.tsx'
import { inject, mountGraphWorkflowStudio } from '../src/client/mount.ts'

const REMOTE: TypertRemoteContribution = { package: 'dsh-graph-workflow', descriptors: [] }

describe('Graph Workflow client registration', () => {
  it('mounts generated Remote first, registers a disposable Workspace resource section, and preserves no-session errors', async () => {
    const ctx = new Context()
    class RemoteService extends Service {
      readonly disposeMount = vi.fn(() => Promise.resolve())
      readonly mount = vi.fn((_contribution: unknown) => Promise.resolve(this.disposeMount))

      constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }

      $mount(contribution: unknown): Promise<() => Promise<void>> { return this.mount(contribution) }
    }
    const remote = new RemoteService(ctx)
    let current: SessionId | undefined
    const catalog = vi.fn(() => Promise.resolve({ ok: true as const, value: { workspaceId: 'workspace-a', revision: 0, workflows: [] } }))
    const deleteWorkflow = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'GRAPH_WORKFLOW_NOT_FOUND', message: 'missing', details: {} },
    }))
    ctx.provide('remote.graphWorkflows', {
      catalog,
      save: vi.fn(),
      deleteWorkflow,
      start: vi.fn(),
      runs: vi.fn(),
      cancel: vi.fn(),
    })
    ctx.provide('sessions', { list: { getSnapshot: () => ({ current }) } })
    ctx.provide('locale', new LocaleRuntime(ctx))
    await ctx.plugin(SlotRegistry).await()
    const removeRoot = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar.workspace.section': { kind: 'list', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({
      inject: [...inject],
      apply: clientCtx => mountGraphWorkflowStudio(clientCtx, REMOTE),
    })
    await fiber.await()
    const entry = ctx.slots.entries('sidebar.workspace.section')
      .find(candidate => candidate.component === WorkspaceGraphWorkflowSection)
    expect(inject).toEqual(['remote', 'slots', 'locale', 'sessions'])
    expect(entry).toMatchObject({ options: { id: 'graph-workflow', order: 30 }, locale: 'graphWorkflow' })
    expect(ctx.slots.entries('sidebar.footer.action')).toEqual([])
    expect(ctx.slots.entries('settings.section')).toEqual([])
    expect(remote.mount).toHaveBeenCalledWith(REMOTE)
    const actions = (entry?.inject as unknown as () => GraphWorkflowStudioInjected)()
    await expect(actions.catalog({ workspaceId: 'workspace-a' })).resolves.toEqual({
      ok: true, value: { workspaceId: 'workspace-a', revision: 0, workflows: [] },
    })
    expect(catalog).toHaveBeenCalledWith({ workspaceId: 'workspace-a' })
    catalog.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'GRAPH_WORKFLOW_CONFLICT', message: 'stale revision', details: {} },
    } as never)
    await expect(actions.catalog({ workspaceId: 'workspace-a' })).resolves.toEqual({
      ok: false, kind: 'domain', code: 'GRAPH_WORKFLOW_CONFLICT', message: 'GRAPH_WORKFLOW_CONFLICT: stale revision',
    })
    catalog.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'internal', message: 'offline', details: {} },
    } as never)
    await expect(actions.catalog({ workspaceId: 'workspace-a' })).resolves.toEqual({ ok: false, kind: 'transport', code: 'internal', message: 'offline' })
    await expect(actions.runs()).resolves.toEqual({ ok: false, kind: 'no-session', message: 'no current session' })

    current = 'graph-client-session' as SessionId
    await expect(actions.remove({ workflowId: 'missing', expectedRevision: 1 })).resolves.toEqual({
      ok: false, kind: 'domain', code: 'GRAPH_WORKFLOW_NOT_FOUND', message: 'GRAPH_WORKFLOW_NOT_FOUND: missing',
    })
    expect(deleteWorkflow).toHaveBeenCalledWith(current, { workflowId: 'missing', expectedRevision: 1 })
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.workspace.section')).toEqual([])
    expect(remote.disposeMount).toHaveBeenCalledOnce()
    removeRoot()
    await ctx.fiber.dispose()
  })
})
