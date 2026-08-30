import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { GraphWorkflowLimits, StartGraphWorkflowRequest } from './domain.ts'
import { catalogEntries } from './domain.ts'
import { GraphWorkflowError } from './errors.ts'
import { GraphWorkflowService, type GraphWorkflowServiceLimits } from './service.ts'
import { GraphWorkflowStore } from './store.ts'

export type * from './domain.ts'
export { GraphWorkflowError, type GraphWorkflowErrorCode } from './errors.ts'
export { GRAPH_WORKFLOW_SCRIPT } from './executor.ts'
export { GraphWorkflowService, type GraphWorkflowServiceLimits } from './service.ts'
export { GraphWorkflowStore } from './store.ts'

export const name = 'graph-workflow'
// The Web profile owns one workflowEngine inside each live Agent preset rather
// than on the Host root. Execution resolves that exact Agent-scoped service.
export const inject = ['tools', 'skills', 'llm', 'agents', 'workspaceRegistry']

/** Deployment policy for storage, definition size, execution, and retention. */
export interface Config {
  readonly storageFile?: string
  readonly maxWorkflows?: number
  readonly maxNodesPerWorkflow?: number
  readonly maxInputChars?: number
  readonly maxPromptChars?: number
  readonly maxSkillChars?: number
  readonly maxResultChars?: number
  readonly maxActiveRunsPerAgent?: number
  readonly retainedRuns?: number
  readonly seedExample?: boolean
}

/** Loader-visible runtime validation and defaults. */
export const Config: z<Config> = z.object({
  storageFile: z.string().default('.dsh/graph-workflows.json'),
  maxWorkflows: z.natural().min(1).default(100),
  maxNodesPerWorkflow: z.natural().min(1).max(128).default(32),
  maxInputChars: z.natural().min(1).default(20_000),
  maxPromptChars: z.natural().min(1).default(12_000),
  maxSkillChars: z.natural().min(1).default(50_000),
  maxResultChars: z.natural().min(1).default(50_000),
  maxActiveRunsPerAgent: z.natural().min(1).max(64).default(4),
  retainedRuns: z.natural().min(1).max(1_000).default(50),
  seedExample: z.boolean().default(true),
})

interface ResolvedConfig extends GraphWorkflowLimits, GraphWorkflowServiceLimits {
  readonly storageFile: string
  readonly seedExample: boolean
}

/** Open Host truth, publish the service, and register the two model tools. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = resolveConfig(config)
  const store = await GraphWorkflowStore.open(resolved.storageFile, resolved)
  const service = new GraphWorkflowService(ctx, store, resolved)

  ctx.tools.register(defineTool({
    name: 'list_graph_workflows',
    description: 'List reusable visual DAG workflows and the structured input each one needs. Use this before run_graph_workflow when the requested workflow id or required fields are not already known.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workflows: {
            type: 'array',
            required: true,
            items: { type: 'json' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      if (exec.agent === undefined) {
        throw new GraphWorkflowError('list_graph_workflows requires a calling agent', 'GRAPH_WORKFLOW_AGENT_NOT_LIVE')
      }
      return { workflows: catalogEntries(await service.catalogForAgent(exec.agent)) as unknown as JsonValue[] }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'run_graph_workflow',
    description: 'Run the published revision of one saved DAG workflow from structured input, or an explicit immutable revision when requested. Each node uses its configured prompt, optional skill and model route, passes deterministic acceptance checks, and the final accepted output is returned ready for delivery. Call list_graph_workflows first if required inputs are unknown.',
    parameters: {
      workflowId: {
        type: 'string',
        required: true,
        description: 'Saved lower-kebab-case workflow id, for example xiaohongshu-content.',
      },
      workflowRevision: {
        type: 'integer',
        description: 'Optional immutable saved revision. Omit to use the workflow revision currently published for production.',
      },
      input: {
        type: 'object',
        required: true,
        additionalProperties: true,
        properties: {},
        description: 'Workflow-specific string values keyed by the input definitions returned from list_graph_workflows.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          workflowId: { type: 'string', required: true },
          workflowRevision: { type: 'integer', required: true },
          deliverable: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.deliverable }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new GraphWorkflowError('run_graph_workflow requires a calling agent', 'GRAPH_WORKFLOW_AGENT_NOT_LIVE')
      }
      const request: StartGraphWorkflowRequest = {
        workflowId: args.workflowId,
        input: args.input as Readonly<Record<string, string>>,
        ...(args.workflowRevision === undefined ? {} : { workflowRevision: args.workflowRevision }),
      }
      return await service.execute(exec.agent, request, exec.signal)
    },
    presentCall: args => ({
      card: 'generic',
      title: `DAG: ${args.workflowId}`,
      rawInput: JSON.stringify(args.input, null, 2),
    }),
    presentResult: () => ({ card: 'generic' }),
  }))
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    storageFile: nonEmpty(config.storageFile ?? '.dsh/graph-workflows.json', 'storageFile'),
    maxWorkflows: positive(config.maxWorkflows ?? 100, 'maxWorkflows', 100_000),
    maxNodesPerWorkflow: positive(config.maxNodesPerWorkflow ?? 32, 'maxNodesPerWorkflow', 128),
    maxInputChars: positive(config.maxInputChars ?? 20_000, 'maxInputChars', 10_000_000),
    maxPromptChars: positive(config.maxPromptChars ?? 12_000, 'maxPromptChars', 1_000_000),
    maxSkillChars: positive(config.maxSkillChars ?? 50_000, 'maxSkillChars', 10_000_000),
    maxResultChars: positive(config.maxResultChars ?? 50_000, 'maxResultChars', 10_000_000),
    maxActiveRunsPerAgent: positive(config.maxActiveRunsPerAgent ?? 4, 'maxActiveRunsPerAgent', 64),
    retainedRuns: positive(config.retainedRuns ?? 50, 'retainedRuns', 1_000),
    seedExample: config.seedExample ?? true,
  }
}

function positive(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new GraphWorkflowError(
      `${label} must be a positive safe integer no greater than ${String(maximum)}`,
      'GRAPH_WORKFLOW_INVALID',
    )
  }
  return value
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GraphWorkflowError(`${label} must be a non-empty string`, 'GRAPH_WORKFLOW_INVALID')
  }
  return value.trim()
}
