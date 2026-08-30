import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable failures exposed by the Graph Workflow Host boundary. */
export type GraphWorkflowErrorCode =
  | 'GRAPH_WORKFLOW_ABORTED'
  | 'GRAPH_WORKFLOW_AGENT_NOT_LIVE'
  | 'GRAPH_WORKFLOW_BUSY'
  | 'GRAPH_WORKFLOW_CONFLICT'
  | 'GRAPH_WORKFLOW_DISPOSED'
  | 'GRAPH_WORKFLOW_EXECUTION_FAILED'
  | 'GRAPH_WORKFLOW_INPUT_INVALID'
  | 'GRAPH_WORKFLOW_INVALID'
  | 'GRAPH_WORKFLOW_NOT_FOUND'
  | 'GRAPH_WORKFLOW_NOT_PUBLISHED'
  | 'GRAPH_WORKFLOW_RESULT_INVALID'
  | 'GRAPH_WORKFLOW_RESULT_TOO_LARGE'
  | 'GRAPH_WORKFLOW_RUN_NOT_FOUND'
  | 'GRAPH_WORKFLOW_SKILL_FORBIDDEN'
  | 'GRAPH_WORKFLOW_SKILL_NOT_FOUND'
  | 'GRAPH_WORKFLOW_STORE_INVALID'
  | 'GRAPH_WORKFLOW_STORE_WRITE_FAILED'
  | 'GRAPH_WORKFLOW_VERSION_NOT_FOUND'
  | 'GRAPH_WORKFLOW_WORKSPACE_NOT_FOUND'

/** Machine-routable plugin failure with a bounded public message. */
export class GraphWorkflowError extends HarnessError {
  declare readonly code: GraphWorkflowErrorCode

  constructor(message: string, code: GraphWorkflowErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'GraphWorkflowError'
  }
}

/** Throw the caller's exact abort reason when possible. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new GraphWorkflowError('graph workflow operation was aborted', 'GRAPH_WORKFLOW_ABORTED')
}
