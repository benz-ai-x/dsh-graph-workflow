import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowRunCatalog,
  GraphWorkflowRunReceipt,
  GraphWorkflowRunSnapshot,
  RemoveGraphWorkflowRequest,
  SaveGraphWorkflowRequest,
  StartGraphWorkflowRequest,
} from 'dsh-graph-workflow/types'
import type {} from 'dsh-graph-workflow/remote'
import { GraphWorkflowStudio, type GraphWorkflowStudioInjected, type UiResult } from './GraphWorkflowStudio.tsx'
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
    async catalog(): Promise<UiResult<GraphWorkflowCatalog>> {
      try {
        return normalize(await ctx.remote.graphWorkflows.catalog())
      } catch (error) {
        return { ok: false, kind: 'transport', message: messageOf(error) }
      }
    },
    save: (request: SaveGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.save(agentId, request)),
    remove: (request: RemoveGraphWorkflowRequest): Promise<UiResult<GraphWorkflowDefinition>> =>
      withSession(agentId => ctx.remote.graphWorkflows.remove(agentId, request)),
    start: (request: StartGraphWorkflowRequest, signal: AbortSignal): Promise<UiResult<GraphWorkflowRunReceipt>> =>
      withSession(agentId => ctx.remote.graphWorkflows.start(agentId, request, signal)),
    runs: (): Promise<UiResult<GraphWorkflowRunCatalog>> =>
      withSession(agentId => ctx.remote.graphWorkflows.runs(agentId)),
    cancel: (runId: string): Promise<UiResult<GraphWorkflowRunSnapshot>> =>
      withSession(agentId => ctx.remote.graphWorkflows.cancel(agentId, { runId })),
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'graph-workflow',
    order: 30,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: () => actions,
  }, GraphWorkflowStudio))
}

/** Mount generated Remote descriptors before publishing the settings page. */
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
