import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as graphWorkflow from '../src/index.ts'

class NoopWorkflowEngine extends WorkflowEngine {
  start(_request: WorkflowStartRequest): WorkflowRun {
    throw new Error('the catalog test must not start a workflow')
  }
}

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function harness(): Promise<{ ctx: Context; storageFile: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-plugin-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(NoopWorkflowEngine)
  return { ctx, storageFile: join(directory, 'workflows.json') }
}

async function list(ctx: Context) {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`list-${Math.random().toString(16).slice(2)}`),
    name: 'list_graph_workflows',
    arguments: {},
    signal: new AbortController().signal,
  })
  if (result.isError) throw new Error('list_graph_workflows unexpectedly failed')
  return result.value
}

describe('Graph Workflow plugin composition', () => {
  it('keeps the Loader-safe namespace surface and exact dependency declaration', () => {
    expect('default' in graphWorkflow).toBe(false)
    expect(graphWorkflow.name).toBe('graph-workflow')
    expect(graphWorkflow.inject).toEqual(['tools', 'workflowEngine', 'skills', 'agents'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(graphWorkflow)).toBe(graphWorkflow)
  })

  it('registers both tools, commits the seed externally, and unwinds cleanly across HMR', async () => {
    const { ctx, storageFile } = await harness()
    const first = await ctx.plugin(graphWorkflow, { storageFile, seedExample: true })

    expect(ctx.tools.schemas().filter(schema => schema.name.includes('graph_workflow')).map(schema => schema.name).sort())
      .toEqual(['list_graph_workflows', 'run_graph_workflow'])
    await expect(list(ctx)).resolves.toMatchObject({
      workflows: [expect.objectContaining({ id: 'xiaohongshu-content', nodeCount: 4 })],
    })
    const durable = JSON.parse(await readFile(storageFile, 'utf8')) as { workflows: { id: string }[] }
    expect(durable.workflows.map(workflow => workflow.id)).toEqual(['xiaohongshu-content'])

    await first.dispose()
    expect(ctx.tools.get('list_graph_workflows')).toBeUndefined()
    expect(ctx.tools.get('run_graph_workflow')).toBeUndefined()
    expect(ctx.get('graphWorkflows')).toBeUndefined()

    const second = await ctx.plugin(graphWorkflow, { storageFile, seedExample: false })
    await expect(list(ctx)).resolves.toMatchObject({
      workflows: [expect.objectContaining({ id: 'xiaohongshu-content', revision: 1 })],
    })
    await second.dispose()
  })
})
