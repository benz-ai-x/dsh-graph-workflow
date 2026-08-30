// Boots the same namespace/config route used by a profile and proves that the
// Loader-supplied storage path receives the durable seed commit.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as graphWorkflow from '../src/index.ts'

class LoaderWorkflowEngine extends WorkflowEngine {
  start(_request: WorkflowStartRequest): WorkflowRun {
    throw new Error('the Loader catalog smoke must not start a workflow')
  }
}

let context: Context | undefined
let directory: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('Graph Workflow through the real Cordis Loader', () => {
  it('applies cordis.yml configuration and exposes the seeded model catalog', async () => {
    directory = await mkdtemp(join(tmpdir(), 'graph-workflow-loader-'))
    const storageFile = join(directory, 'configured-store.json')
    const template = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
    const configPath = join(directory, 'cordis.yml')
    await writeFile(configPath, template.replace('__STORAGE_FILE__', storageFile))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = `${pathToFileURL(directory).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-skill', SkillRegistry],
      ['@deepseek-ai/dsh-workflow', LoaderWorkflowEngine],
      ['dsh-graph-workflow', graphWorkflow],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const result = await ctx.tools.execute({
      callId: ToolCallId('loader-list'),
      name: 'list_graph_workflows',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected Loader-installed list tool to succeed')
    expect(result.value).toMatchObject({
      workflows: [expect.objectContaining({ id: 'xiaohongshu-content', nodeCount: 4 })],
    })
    const stored = JSON.parse(await readFile(storageFile, 'utf8')) as { workflows: unknown[] }
    expect(stored.workflows).toHaveLength(1)
  }, 30_000)
})
