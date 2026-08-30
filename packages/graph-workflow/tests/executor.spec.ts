import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { GraphWorkflowDefinition, GraphWorkflowDraft } from '../src/domain.ts'
import { normalizeWorkflowDraft } from '../src/domain.ts'
import {
  GRAPH_WORKFLOW_SCRIPT,
  decodeGraphWorkflowProgramResult,
  prepareGraphWorkflowArguments,
} from '../src/executor.ts'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

function definition(draft: GraphWorkflowDraft): GraphWorkflowDefinition {
  return {
    ...normalizeWorkflowDraft(draft, { maxNodesPerWorkflow: 16, maxPromptChars: 4_000, maxInputChars: 4_000 }),
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

const flow = definition({
  id: 'parallel-flow',
  name: 'Parallel flow',
  description: 'Two independent nodes then one join.',
  inputs: [{ key: 'brief', label: 'Brief', required: true }],
  nodes: [
    { id: 'angle-a', name: 'Angle A', dependsOn: [], prompt: 'A {{input.brief}}', acceptance: { mustInclude: ['A:'] } },
    { id: 'angle-b', name: 'Angle B', dependsOn: [], prompt: 'B {{input.brief}}' },
    { id: 'merge', name: 'Merge', dependsOn: ['angle-a', 'angle-b'], prompt: '{{nodes.angle-a}} + {{nodes.angle-b}}', acceptance: { minChars: 5 } },
  ],
  outputNode: 'merge',
})

async function execute(args: unknown, child: (prompt: string, options: Record<string, string>) => Promise<string | null>) {
  const program = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', GRAPH_WORKFLOW_SCRIPT)
  return await program(
    args,
    child,
    async (thunks: Array<() => Promise<unknown>>) => await Promise.all(thunks.map(thunk => thunk().catch(() => null))),
    () => undefined,
    () => undefined,
  )
}

describe('fixed Graph Workflow program', () => {
  it('fans ready nodes out, joins their outputs, and returns the configured deliverable', async () => {
    const skills = { get: vi.fn() } as unknown as SkillRegistry
    const agent = { session: { header: {} } } as unknown as Agent
    const args = await prepareGraphWorkflowArguments(skills, flow, { brief: 'launch' }, agent, undefined, 1_000)
    const calls: string[] = []
    const raw = await execute(args, async (_prompt, options) => {
      calls.push(options.label)
      if (options.label === 'gw:angle-a') return 'A: insight'
      if (options.label === 'gw:angle-b') return 'B insight'
      return 'final deliverable'
    })
    const result = decodeGraphWorkflowProgramResult(raw)
    expect(result).toMatchObject({ ok: true, deliverable: 'final deliverable' })
    expect(calls.slice(0, 2).sort()).toEqual(['gw:angle-a', 'gw:angle-b'])
    expect(calls[2]).toBe('gw:merge')
  })

  it('returns a typed failed node when deterministic acceptance rejects output', async () => {
    const args = await prepareGraphWorkflowArguments(
      { get: vi.fn() } as unknown as SkillRegistry,
      flow,
      { brief: 'launch' },
      { session: { header: {} } } as unknown as Agent,
      undefined,
      1_000,
    )
    const result = decodeGraphWorkflowProgramResult(await execute(args, async (_prompt, options) =>
      options.label === 'gw:angle-a' ? 'missing marker' : 'other'))
    expect(result).toEqual({
      ok: false,
      failure: { code: 'GRAPH_NODE_REJECTED', message: 'output must include: A:', nodeId: 'angle-a' },
      outputs: [],
    })
  })

  it('keeps hostile user data in args/prompt data and never changes executable source', async () => {
    const hostile = "'}); globalThis.pwned = true; //"
    const args = await prepareGraphWorkflowArguments(
      { get: vi.fn() } as unknown as SkillRegistry,
      flow,
      { brief: hostile },
      { session: { header: {} } } as unknown as Agent,
      undefined,
      1_000,
    )
    expect(GRAPH_WORKFLOW_SCRIPT).not.toContain(hostile)
    const prompts: string[] = []
    await execute(args, async (prompt, options) => {
      prompts.push(prompt)
      return options.label === 'gw:angle-a' ? 'A: ok' : 'good output'
    })
    expect(prompts[0]).toContain(hostile)
    expect((globalThis as Record<string, unknown>)['pwned']).toBeUndefined()
  })

  it('loads a configured model-invocable skill in the current Agent scope', async () => {
    const get = vi.fn().mockResolvedValue({
      name: 'brand-voice',
      description: 'voice',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'runtime',
      content: 'Use the approved voice.',
    })
    const withSkill = definition({
      ...flow,
      nodes: [{ ...flow.nodes[0]!, skill: 'brand-voice' }],
      outputNode: 'angle-a',
    })
    const agent = { session: { header: { cwd: '/workspace' } } } as unknown as Agent
    const args = await prepareGraphWorkflowArguments({ get } as unknown as SkillRegistry, withSkill, { brief: 'x' }, agent, undefined, 1_000)
    expect(get).toHaveBeenCalledWith('brand-voice', expect.objectContaining({ cwd: '/workspace', scope: agent }))
    expect(args.nodes[0]?.skillContent).toContain('Use the approved voice.')
  })
})
