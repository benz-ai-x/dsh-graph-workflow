import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GraphWorkflowCatalog,
  GraphWorkflowCapabilityCatalog,
  GraphWorkflowDefinition,
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
} from 'dsh-graph-workflow/types'
import type {} from 'dsh-graph-workflow/remote'
import type { GraphWorkflowStudioInjected, UiResult } from './GraphWorkflowStudio.tsx'
import { WorkspaceGraphWorkflowSection } from './WorkspaceGraphWorkflowSection.tsx'
import { en, NS, zh, type GraphWorkflowLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    graphWorkflow: GraphWorkflowLocaleKey
  }
}

export const inject = ['remote', 'slots', 'locale', 'sessions']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalize<T>(result: RemoteResult<T>): UiResult<T> {
  return result.ok
    ? { ok: true, value: result.value }
    : {
        ok: false,
        kind: result.error.code.startsWith('GRAPH_WORKFLOW_') ? 'domain' : 'transport',
        code: result.error.code,
        message: result.error.code.startsWith('GRAPH_WORKFLOW_')
          ? `${result.error.code}: ${result.error.message}`
          : result.error.message,
      }
}

function registerStudio(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'graph-workflow: dictionaries')

  const withSession = async <T>(
    invoke: (agentId: NonNullable<ReturnType<typeof currentSession>>) => Promise<RemoteResult<T>>,
  ): Promise<UiResult<T>> => {
    const agentId = currentSession()
    if (agentId === undefined) return { ok: false, kind: 'no-session', message: 'no current session' }
    try {
      return normalize(await invoke(agentId))
    } catch (error) {
      return { ok: false, kind: 'transport', message: messageOf(error) }
    }
  }

  const currentSession = () => ctx.sessions.list.getSnapshot().current
  const actions: GraphWorkflowStudioInjected = {
    async catalog(request: GraphWorkflowWorkspaceRequest): Promise<UiResult<GraphWorkflowCatalog>> {
      try {
        return normalize(await ctx.remote.graphWorkflows.catalog(request))
      } catch (error) {
        return { ok: false, kind: 'transport', message: messageOf(error) }
      }
    },
    async versions(request: GraphWorkflowVersionsRequest): Promise<UiResult<GraphWorkflowVersionCatalog>> {
      try {
        return normalize(await ctx.remote.graphWorkflows.versions(request))
      } catch (error) {
        return { ok: false, kind: 'transport', message: messageOf(error) }
      }
    },
    save: (request: SaveGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.save(agentId, request)),
    publish: (request: PublishGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.publish(agentId, request)),
    restore: (request: RestoreGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.restore(agentId, request)),
    remove: (request: RemoveGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.deleteWorkflow(agentId, request)),
    capabilities: (): Promise<UiResult<GraphWorkflowCapabilityCatalog>> =>
      withSession(agentId => ctx.remote.graphWorkflows.capabilities(agentId)),
    testCases: (request: GraphWorkflowTestCasesRequest): Promise<UiResult<GraphWorkflowTestCaseCatalog>> =>
      withSession(agentId => ctx.remote.graphWorkflows.testCases(agentId, request)),
    saveTestCase: (request: SaveGraphWorkflowTestCaseRequest): Promise<UiResult<GraphWorkflowTestCase>> =>
      withSession(agentId => ctx.remote.graphWorkflows.saveTestCase(agentId, request)),
    removeTestCase: (request: RemoveGraphWorkflowTestCaseRequest): Promise<UiResult<GraphWorkflowTestCase>> =>
      withSession(agentId => ctx.remote.graphWorkflows.deleteTestCase(agentId, request)),
    start: (request: StartGraphWorkflowRequest, signal: AbortSignal): Promise<UiResult<GraphWorkflowRunReceipt>> =>
      withSession(agentId => ctx.remote.graphWorkflows.start(agentId, request, signal)),
    runs: (): Promise<UiResult<GraphWorkflowRunCatalog>> =>
      withSession(agentId => ctx.remote.graphWorkflows.runs(agentId)),
    cancel: (runId: string): Promise<UiResult<GraphWorkflowRunSnapshot>> =>
      withSession(agentId => ctx.remote.graphWorkflows.cancel(agentId, { runId })),
  }

  ctx.slots.inject('sidebar.workspace.section', () => ctx.slots.register({
    name: 'sidebar.workspace.section',
    id: 'graph-workflow',
    order: 30,
    locale: NS,
    inject: () => actions,
  }, WorkspaceGraphWorkflowSection))
}

/** Mount generated Remote descriptors before publishing the Workspace resource section. */
export async function mountGraphWorkflowStudio(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.graphWorkflows', 'slots', 'locale', 'sessions'], registerStudio)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
