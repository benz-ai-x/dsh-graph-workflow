import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as graphWorkflow from '../src/index.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function registerAgent(ctx: Context, rawId: string): Agent {
  const id = SessionId(rawId)
  const scope = ctx.plugin(() => {})
  const agent = {
    id,
    session: Session.create(id),
    options: {},
    ctx: scope.ctx,
    status: 'idle',
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
  } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

async function harness(): Promise<{ ctx: Context; storageFile: string; agent: Agent }> {
  const directory = await mkdtemp(join(tmpdir(), 'graph-workflow-plugin-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SkillRegistry)
  const agent = registerAgent(ctx, `plugin-agent-${Math.random().toString(16).slice(2)}`)
  ctx.provide('workspaceRegistry', {
    list: () => [{ id: 'workspace-a', path: directory, title: 'A', sessionIds: [agent.id] }],
  } as never)
  return { ctx, storageFile: join(directory, 'workflows.json'), agent }
}

async function list(ctx: Context, agent: Agent) {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`list-${Math.random().toString(16).slice(2)}`),
    name: 'list_graph_workflows',
    arguments: {},
    agent,
    signal: new AbortController().signal,
  })
  if (result.isError) throw new Error('list_graph_workflows unexpectedly failed')
  return result.value
}

describe('Graph Workflow plugin composition', () => {
  it('keeps the Loader-safe namespace surface and exact dependency declaration', () => {
    expect('default' in graphWorkflow).toBe(false)
    expect(graphWorkflow.name).toBe('graph-workflow')
    expect(graphWorkflow.inject).toEqual(['tools', 'skills', 'llm', 'agents', 'workspaceRegistry'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(graphWorkflow)).toBe(graphWorkflow)
  })

  it('registers both tools, commits the seed externally, and unwinds cleanly across HMR', async () => {
    const { ctx, storageFile, agent } = await harness()
    const first = await ctx.plugin(graphWorkflow, { storageFile, seedExample: true })

    expect(ctx.tools.schemas().filter(schema => schema.name.includes('graph_workflow')).map(schema => schema.name).sort())
      .toEqual(['list_graph_workflows', 'run_graph_workflow'])
    await expect(list(ctx, agent)).resolves.toMatchObject({
      workflows: [expect.objectContaining({ id: 'xiaohongshu-content', nodeCount: 4 })],
    })
    const durable = JSON.parse(await readFile(storageFile, 'utf8')) as { workflows: { id: string }[] }
    expect(durable.workflows.map(workflow => workflow.id)).toEqual(['xiaohongshu-content'])

    await first.dispose()
    expect(ctx.tools.get('list_graph_workflows')).toBeUndefined()
    expect(ctx.tools.get('run_graph_workflow')).toBeUndefined()
    expect(ctx.get('graphWorkflows')).toBeUndefined()

    const second = await ctx.plugin(graphWorkflow, { storageFile, seedExample: false })
    await expect(list(ctx, agent)).resolves.toMatchObject({
      workflows: [expect.objectContaining({ id: 'xiaohongshu-content', revision: 1 })],
    })
    await second.dispose()
  })
})
