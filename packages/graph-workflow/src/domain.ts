import { GraphWorkflowError } from './errors.ts'

const WORKFLOW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NODE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const INPUT_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One structured value requested before a workflow starts. */
export interface GraphWorkflowInputDefinition {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly required: boolean
  readonly defaultValue?: string
}

/** Optional model route override for one DAG node. */
export interface GraphWorkflowLlmSelection {
  readonly provider?: string
  readonly model?: string
}

/** Deterministic checks applied to one node's model output. */
export interface GraphWorkflowAcceptance {
  readonly minChars?: number
  readonly mustInclude?: readonly string[]
  readonly forbidden?: readonly string[]
}

/** One LLM/subagent node and its incoming DAG edges. */
export interface GraphWorkflowNode {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly dependsOn: readonly string[]
  readonly prompt: string
  readonly skill?: string
  readonly llm?: GraphWorkflowLlmSelection
  readonly acceptance?: GraphWorkflowAcceptance
}

/** Editable workflow value before Host-owned revision and timestamps are attached. */
export interface GraphWorkflowDraft {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly inputs: readonly GraphWorkflowInputDefinition[]
  readonly nodes: readonly GraphWorkflowNode[]
  readonly outputNode: string
}

/** Persisted immutable DAG definition. */
export interface GraphWorkflowDefinition extends GraphWorkflowDraft {
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Lightweight selector entry returned to the model and browser catalog. */
export interface GraphWorkflowCatalogEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly revision: number
  readonly inputs: readonly GraphWorkflowInputDefinition[]
  readonly nodeCount: number
  readonly updatedAt: number
}

/** Complete current workflow catalog. */
export interface GraphWorkflowCatalog {
  readonly revision: number
  readonly workflows: readonly GraphWorkflowDefinition[]
}

/** Compare-and-set save request used by the Client editor. */
export interface SaveGraphWorkflowRequest {
  readonly workflow: GraphWorkflowDraft
  readonly expectedRevision?: number
}

/** Compare-and-set removal request used by the Client editor. */
export interface RemoveGraphWorkflowRequest {
  readonly workflowId: string
  readonly expectedRevision: number
}

/** Input needed to launch one saved definition. */
export interface StartGraphWorkflowRequest {
  readonly workflowId: string
  readonly input: Readonly<Record<string, string>>
}

/** Public lifecycle of one DAG run. */
export type GraphWorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Public lifecycle of one DAG node. */
export type GraphWorkflowNodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'

/** Bounded failure attached to a run or node snapshot. */
export interface GraphWorkflowFailure {
  readonly code: string
  readonly message: string
  readonly nodeId?: string
}

/** Live or settled state of one DAG node. */
export interface GraphWorkflowNodeRunSnapshot {
  readonly nodeId: string
  readonly name: string
  readonly status: GraphWorkflowNodeStatus
  readonly startedAt?: number
  readonly endedAt?: number
  readonly output?: string
  readonly error?: GraphWorkflowFailure
}

/** Whole-value process-local projection consumed by the browser. */
export interface GraphWorkflowRunSnapshot {
  readonly runId: string
  readonly workflowId: string
  readonly workflowName: string
  readonly workflowRevision: number
  readonly revision: number
  readonly status: GraphWorkflowRunStatus
  readonly createdAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly input: Readonly<Record<string, string>>
  readonly nodes: readonly GraphWorkflowNodeRunSnapshot[]
  readonly deliverable?: string
  readonly error?: GraphWorkflowFailure
}

/** Receipt returned once a browser-started run transfers to service ownership. */
export interface GraphWorkflowRunReceipt {
  readonly runId: string
  readonly workflowId: string
  readonly workflowRevision: number
}

/** Cancellation request scoped to the calling exact live Agent. */
export interface CancelGraphWorkflowRunRequest {
  readonly runId: string
}

/** Foreground result returned to the model-facing execution tool. */
export interface GraphWorkflowExecutionResult {
  readonly runId: string
  readonly workflowId: string
  readonly workflowRevision: number
  readonly deliverable: string
}

/** Current process-local run list for one exact live Agent. */
export interface GraphWorkflowRunCatalog {
  readonly runs: readonly GraphWorkflowRunSnapshot[]
}

/** Deployment limits that affect domain validation. */
export interface GraphWorkflowLimits {
  readonly maxWorkflows: number
  readonly maxNodesPerWorkflow: number
  readonly maxInputChars: number
  readonly maxPromptChars: number
}

function fail(message: string): never {
  throw new GraphWorkflowError(message, 'GRAPH_WORKFLOW_INVALID')
}

function nonEmpty(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} must be a non-empty string`)
  const normalized = value.trim()
  if (normalized.length > max) fail(`${label} exceeds ${String(max)} characters`)
  return normalized
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined
  return nonEmpty(value, label, max)
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') fail(`${label} must be a string`)
  if (value.length > max) fail(`${label} exceeds ${String(max)} characters`)
  return value
}

function assertOptionalRecord(value: unknown, label: string): void {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    fail(`${label} must be an object`)
  }
}

function positiveInteger(value: unknown, label: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    fail(`${label} must be an integer between 1 and ${String(max)}`)
  }
  return value as number
}

function uniqueStrings(values: readonly string[] | undefined, label: string, maxItems = 32): string[] | undefined {
  if (values === undefined) return undefined
  if (!Array.isArray(values) || values.length > maxItems) fail(`${label} must contain at most ${String(maxItems)} strings`)
  const normalized = values.map((value, index) => nonEmpty(value, `${label}[${String(index)}]`, 200))
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate values`)
  return normalized
}

/** Return deterministic topological layers, rejecting cycles and dangling edges. */
export function topologicalLayers(nodes: readonly GraphWorkflowNode[]): string[][] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const incoming = new Map(nodes.map(node => [node.id, new Set(node.dependsOn)]))
  const layers: string[][] = []
  const emitted = new Set<string>()
  while (emitted.size < nodes.length) {
    const ready = nodes
      .filter(node => !emitted.has(node.id) && [...(incoming.get(node.id) ?? [])].every(id => emitted.has(id)))
      .map(node => node.id)
    if (ready.length === 0) fail('workflow graph contains a cycle')
    for (const id of ready) {
      if (!byId.has(id)) fail(`workflow graph contains unknown node "${id}"`)
      emitted.add(id)
    }
    layers.push(ready)
  }
  return layers
}

function ancestorsOf(nodeId: string, byId: ReadonlyMap<string, GraphWorkflowNode>, memo = new Map<string, Set<string>>()): Set<string> {
  const cached = memo.get(nodeId)
  if (cached !== undefined) return cached
  const result = new Set<string>()
  memo.set(nodeId, result)
  for (const dependency of byId.get(nodeId)?.dependsOn ?? []) {
    result.add(dependency)
    for (const ancestor of ancestorsOf(dependency, byId, memo)) result.add(ancestor)
  }
  return result
}

function validateTemplate(
  prompt: string,
  node: GraphWorkflowNode,
  inputKeys: ReadonlySet<string>,
  byId: ReadonlyMap<string, GraphWorkflowNode>,
): void {
  const ancestors = ancestorsOf(node.id, byId)
  for (const match of prompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const reference = match[1] as string
    if (reference === 'input') continue
    if (reference.startsWith('input.')) {
      const key = reference.slice('input.'.length)
      if (!inputKeys.has(key)) fail(`node "${node.id}" references unknown input "${key}"`)
      continue
    }
    if (reference.startsWith('nodes.')) {
      const dependency = reference.slice('nodes.'.length)
      if (!byId.has(dependency)) fail(`node "${node.id}" references unknown node "${dependency}"`)
      if (!ancestors.has(dependency)) {
        fail(`node "${node.id}" references "${dependency}" without a dependency path`)
      }
      continue
    }
    fail(`node "${node.id}" contains unsupported template reference "${reference}"`)
  }
}

/** Validate, normalize, detach, and deeply freeze one editable DAG. */
export function normalizeWorkflowDraft(
  input: GraphWorkflowDraft,
  limits: Pick<GraphWorkflowLimits, 'maxNodesPerWorkflow' | 'maxPromptChars' | 'maxInputChars'>,
): GraphWorkflowDraft {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('workflow must be an object')
  const id = nonEmpty(input.id, 'workflow.id', 64)
  if (!WORKFLOW_ID.test(id)) fail('workflow.id must be lower-kebab-case')
  const name = nonEmpty(input.name, 'workflow.name', 100)
  const description = nonEmpty(input.description, 'workflow.description', 500)
  if (!Array.isArray(input.inputs) || input.inputs.length > 32) fail('workflow.inputs must contain at most 32 entries')
  const inputKeys = new Set<string>()
  let defaultInputChars = 0
  const inputs = input.inputs.map((item, index): GraphWorkflowInputDefinition => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) fail(`workflow.inputs[${String(index)}] must be an object`)
    const key = nonEmpty(item.key, `workflow.inputs[${String(index)}].key`, 48)
    if (!INPUT_KEY.test(key)) fail(`input key "${key}" must be lower_snake_case`)
    if (inputKeys.has(key)) fail(`duplicate workflow input "${key}"`)
    inputKeys.add(key)
    if (typeof item.required !== 'boolean') fail(`workflow input "${key}" requires a boolean required field`)
    const itemDescription = optionalText(item.description, `workflow input "${key}" description`, 300)
    const defaultValue = item.defaultValue === undefined
      ? undefined
      : boundedString(item.defaultValue, `workflow input "${key}" defaultValue`, limits.maxInputChars)
    defaultInputChars += defaultValue?.length ?? 0
    if (defaultInputChars > limits.maxInputChars) {
      fail(`workflow input defaults exceed ${String(limits.maxInputChars)} characters`)
    }
    return {
      key,
      label: nonEmpty(item.label, `workflow input "${key}" label`, 100),
      required: item.required,
      ...(itemDescription === undefined ? {} : { description: itemDescription }),
      ...(defaultValue === undefined ? {} : { defaultValue }),
    }
  })
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > limits.maxNodesPerWorkflow) {
    fail(`workflow.nodes must contain between 1 and ${String(limits.maxNodesPerWorkflow)} entries`)
  }
  const nodeIds = new Set<string>()
  const nodes = input.nodes.map((item, index): GraphWorkflowNode => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) fail(`workflow.nodes[${String(index)}] must be an object`)
    const nodeId = nonEmpty(item.id, `workflow.nodes[${String(index)}].id`, 48)
    if (!NODE_ID.test(nodeId)) fail(`node id "${nodeId}" must be lower-kebab-case and start with a letter`)
    if (nodeIds.has(nodeId)) fail(`duplicate workflow node "${nodeId}"`)
    nodeIds.add(nodeId)
    if (!Array.isArray(item.dependsOn)) fail(`node "${nodeId}" dependsOn must be an array`)
    const dependsOn = uniqueStrings(item.dependsOn, `node "${nodeId}" dependsOn`, limits.maxNodesPerWorkflow) ?? []
    if (dependsOn.includes(nodeId)) fail(`node "${nodeId}" cannot depend on itself`)
    const skill = optionalText(item.skill, `node "${nodeId}" skill`, 100)
    if (skill !== undefined && !SKILL_NAME.test(skill)) fail(`node "${nodeId}" skill must be lower-kebab-case`)
    assertOptionalRecord(item.llm, `node "${nodeId}" llm`)
    assertOptionalRecord(item.acceptance, `node "${nodeId}" acceptance`)
    const provider = optionalText(item.llm?.provider, `node "${nodeId}" provider`, 100)
    const model = optionalText(item.llm?.model, `node "${nodeId}" model`, 200)
    const minChars = positiveInteger(item.acceptance?.minChars, `node "${nodeId}" acceptance.minChars`, 100_000)
    const mustInclude = uniqueStrings(item.acceptance?.mustInclude, `node "${nodeId}" acceptance.mustInclude`)
    const forbidden = uniqueStrings(item.acceptance?.forbidden, `node "${nodeId}" acceptance.forbidden`)
    const nodeDescription = optionalText(item.description, `node "${nodeId}" description`, 300)
    return {
      id: nodeId,
      name: nonEmpty(item.name, `node "${nodeId}" name`, 100),
      dependsOn,
      prompt: nonEmpty(item.prompt, `node "${nodeId}" prompt`, limits.maxPromptChars),
      ...(nodeDescription === undefined ? {} : { description: nodeDescription }),
      ...skill === undefined ? {} : { skill },
      ...provider === undefined && model === undefined ? {} : { llm: {
        ...provider === undefined ? {} : { provider },
        ...model === undefined ? {} : { model },
      } },
      ...minChars === undefined && mustInclude === undefined && forbidden === undefined ? {} : { acceptance: {
        ...minChars === undefined ? {} : { minChars },
        ...mustInclude === undefined ? {} : { mustInclude },
        ...forbidden === undefined ? {} : { forbidden },
      } },
    }
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) fail(`node "${node.id}" depends on unknown node "${dependency}"`)
    }
  }
  topologicalLayers(nodes)
  for (const node of nodes) validateTemplate(node.prompt, node, inputKeys, byId)
  const outputNode = nonEmpty(input.outputNode, 'workflow.outputNode', 48)
  if (!byId.has(outputNode)) fail(`workflow.outputNode "${outputNode}" does not exist`)
  return deepFreeze({ id, name, description, inputs, nodes, outputNode })
}

/** Validate dynamic input keys against one selected workflow and apply defaults. */
export function normalizeRunInput(
  workflow: GraphWorkflowDefinition,
  raw: Readonly<Record<string, unknown>>,
  maxInputChars: number,
): Readonly<Record<string, string>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GraphWorkflowError('workflow input must be an object', 'GRAPH_WORKFLOW_INPUT_INVALID')
  }
  const definitions = new Map(workflow.inputs.map(input => [input.key, input]))
  const unknown = Object.keys(raw).filter(key => !definitions.has(key))
  if (unknown.length > 0) {
    throw new GraphWorkflowError(`unknown workflow input: ${unknown.join(', ')}`, 'GRAPH_WORKFLOW_INPUT_INVALID')
  }
  const result: Record<string, string> = {}
  let size = 0
  for (const definition of workflow.inputs) {
    const supplied = Object.hasOwn(raw, definition.key) ? raw[definition.key] : undefined
    const value = supplied === undefined ? (definition.defaultValue ?? '') : supplied
    if (typeof value !== 'string') {
      throw new GraphWorkflowError(`workflow input "${definition.key}" must be a string`, 'GRAPH_WORKFLOW_INPUT_INVALID')
    }
    if (definition.required && value.trim().length === 0) {
      throw new GraphWorkflowError(`missing required workflow input "${definition.key}"`, 'GRAPH_WORKFLOW_INPUT_INVALID')
    }
    size += value.length
    if (size > maxInputChars) {
      throw new GraphWorkflowError(`workflow input exceeds ${String(maxInputChars)} characters`, 'GRAPH_WORKFLOW_INPUT_INVALID')
    }
    result[definition.key] = value
  }
  return deepFreeze(result)
}

/** Build the lightweight catalog shape used by the model-facing list tool. */
export function catalogEntries(catalog: GraphWorkflowCatalog): GraphWorkflowCatalogEntry[] {
  return catalog.workflows.map(workflow => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    revision: workflow.revision,
    inputs: workflow.inputs,
    nodeCount: workflow.nodes.length,
    updatedAt: workflow.updatedAt,
  }))
}

/** Detach and recursively freeze a JSON-compatible public value. */
export function deepFreeze<T>(value: T): T {
  const detached = structuredClone(value)
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return
    for (const nested of Object.values(candidate)) visit(nested)
    Object.freeze(candidate)
  }
  visit(detached)
  return detached
}

/** Starter DAG demonstrating strategy, drafting, review, and final delivery. */
export const XIAOHONGSHU_WORKFLOW: GraphWorkflowDraft = deepFreeze({
  id: 'xiaohongshu-content',
  name: '小红书运营文案',
  description: '从关键信息到可直接发布的小红书标题、正文、话题标签与自检说明。',
  inputs: [
    { key: 'topic', label: '主题/产品', required: true },
    { key: 'audience', label: '目标人群', required: true },
    { key: 'selling_points', label: '核心卖点', required: true },
    { key: 'tone', label: '语气风格', required: false, defaultValue: '真诚、有画面感、不过度营销' },
  ],
  nodes: [
    {
      id: 'content-strategy',
      name: '内容策略',
      dependsOn: [],
      prompt: '围绕 {{input.topic}}，面向 {{input.audience}}，根据卖点 {{input.selling_points}} 制定一份小红书内容策略。明确用户痛点、内容钩子、叙事结构和互动问题。',
      acceptance: { minChars: 120, mustInclude: ['用户', '结构'] },
    },
    {
      id: 'draft-copy',
      name: '首稿撰写',
      dependsOn: ['content-strategy'],
      prompt: '根据策略 {{nodes.content-strategy}} 撰写小红书初稿。语气要求：{{input.tone}}。输出 3 个标题候选、正文和 6-10 个话题标签。避免虚假承诺。',
      acceptance: { minChars: 260, mustInclude: ['#'] },
    },
    {
      id: 'quality-review',
      name: '质量与合规审校',
      dependsOn: ['draft-copy'],
      prompt: '审校以下文案：{{nodes.draft-copy}}。检查标题吸引力、信息准确性、广告法风险、过度承诺、可读性和平台语感。给出逐项修改指令。',
      acceptance: { minChars: 120, mustInclude: ['风险'] },
    },
    {
      id: 'publish-ready',
      name: '发布版交付',
      dependsOn: ['draft-copy', 'quality-review'],
      prompt: '结合初稿 {{nodes.draft-copy}} 与审校意见 {{nodes.quality-review}}，输出可直接发布的最终版本。只交付 1 个最终标题、正文、话题标签和一行配图建议，不要解释创作过程。',
      acceptance: { minChars: 220, mustInclude: ['#'], forbidden: ['作为AI', '无法提供'] },
    },
  ],
  outputNode: 'publish-ready',
})
