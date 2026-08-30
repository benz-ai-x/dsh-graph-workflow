import graphWorkflowRemote from 'dsh-graph-workflow/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountGraphWorkflowStudio } from './mount.ts'

export { inject } from './mount.ts'
export { GraphWorkflowStudio } from './GraphWorkflowStudio.tsx'
export type { GraphWorkflowStudioInjected, GraphWorkflowStudioProps, UiResult } from './GraphWorkflowStudio.tsx'
export type { GraphWorkflowLocaleKey } from './locales.ts'

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountGraphWorkflowStudio(ctx, graphWorkflowRemote)
}
