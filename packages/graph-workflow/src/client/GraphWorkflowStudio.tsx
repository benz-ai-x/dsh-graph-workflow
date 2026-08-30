import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GraphWorkflowAcceptance,
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowDraft,
  GraphWorkflowInputDefinition,
  GraphWorkflowNode,
  GraphWorkflowRunCatalog,
  GraphWorkflowRunReceipt,
  GraphWorkflowRunSnapshot,
  RemoveGraphWorkflowRequest,
  SaveGraphWorkflowRequest,
  StartGraphWorkflowRequest,
} from 'dsh-graph-workflow/types'
import styles from './GraphWorkflowStudio.module.css'

/** UI-level result preserving domain rejection versus transport failure. */
export type UiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: 'domain' | 'transport' | 'no-session'; readonly message: string }

/** Browser actions injected by the registration layer. */
export interface GraphWorkflowStudioInjected {
  catalog: () => Promise<UiResult<GraphWorkflowCatalog>>
  save: (request: SaveGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  remove: (request: RemoveGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  start: (request: StartGraphWorkflowRequest, signal: AbortSignal) => Promise<UiResult<GraphWorkflowRunReceipt>>
  runs: () => Promise<UiResult<GraphWorkflowRunCatalog>>
  cancel: (runId: string) => Promise<UiResult<GraphWorkflowRunSnapshot>>
}

/** Full settings-section props supplied by the UI renderer. */
export type GraphWorkflowStudioProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'graphWorkflow'>
  & InjectFace<GraphWorkflowStudioInjected>

interface Point {
  readonly x: number
  readonly y: number
}

interface Layout {
  readonly positions: ReadonlyMap<string, Point>
  readonly width: number
  readonly height: number
}

const CARD_WIDTH = 220
const CARD_HEIGHT = 116
const COLUMN_GAP = 82
const ROW_GAP = 28
const CANVAS_PAD = 24

const c = (name: string): string => styles[name] ?? ''

function editable(definition: GraphWorkflowDefinition): GraphWorkflowDraft {
  return structuredClone({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    inputs: definition.inputs,
    nodes: definition.nodes,
    outputNode: definition.outputNode,
  })
}

function newWorkflow(catalog: GraphWorkflowCatalog | undefined): GraphWorkflowDraft {
  let suffix = (catalog?.workflows.length ?? 0) + 1
  while (catalog?.workflows.some(workflow => workflow.id === `workflow-${String(suffix)}`) === true) suffix += 1
  return {
    id: `workflow-${String(suffix)}`,
    name: 'New workflow',
    description: 'Describe when this reusable workflow should run.',
    inputs: [{ key: 'brief', label: 'Brief', required: true }],
    nodes: [{
      id: 'draft',
      name: 'Draft',
      dependsOn: [],
      prompt: 'Complete the task from this brief: {{input.brief}}',
    }],
    outputNode: 'draft',
  }
}

function layersOf(nodes: readonly GraphWorkflowNode[]): string[][] {
  const known = new Set(nodes.map(node => node.id))
  const emitted = new Set<string>()
  const layers: string[][] = []
  while (emitted.size < nodes.length) {
    const ready = nodes
      .filter(node => !emitted.has(node.id)
        && node.dependsOn.filter(dependency => known.has(dependency)).every(dependency => emitted.has(dependency)))
      .map(node => node.id)
    if (ready.length === 0) {
      layers.push(nodes.filter(node => !emitted.has(node.id)).map(node => node.id))
      break
    }
    for (const id of ready) emitted.add(id)
    layers.push(ready)
  }
  return layers
}

function layoutOf(nodes: readonly GraphWorkflowNode[]): Layout {
  const layers = layersOf(nodes)
  const positions = new Map<string, Point>()
  const maximumRows = Math.max(1, ...layers.map(layer => layer.length))
  for (const [column, layer] of layers.entries()) {
    const layerHeight = layer.length * CARD_HEIGHT + Math.max(0, layer.length - 1) * ROW_GAP
    const totalHeight = maximumRows * CARD_HEIGHT + Math.max(0, maximumRows - 1) * ROW_GAP
    const offset = CANVAS_PAD + (totalHeight - layerHeight) / 2
    for (const [row, id] of layer.entries()) {
      positions.set(id, {
        x: CANVAS_PAD + column * (CARD_WIDTH + COLUMN_GAP),
        y: offset + row * (CARD_HEIGHT + ROW_GAP),
      })
    }
  }
  return {
    positions,
    width: Math.max(560, CANVAS_PAD * 2 + layers.length * CARD_WIDTH + Math.max(0, layers.length - 1) * COLUMN_GAP),
    height: Math.max(290, CANVAS_PAD * 2 + maximumRows * CARD_HEIGHT + Math.max(0, maximumRows - 1) * ROW_GAP),
  }
}

function DagCanvas({
  nodes,
  outputNode,
  selected,
  status,
  onSelect,
}: {
  nodes: readonly GraphWorkflowNode[]
  outputNode: string
  selected?: string
  status?: ReadonlyMap<string, GraphWorkflowRunSnapshot['nodes'][number]>
  onSelect?: (id: string) => void
}): ReactNode {
  const layout = useMemo(() => layoutOf(nodes), [nodes])
  return (
    <div className={c('canvasScroll')}>
      <div className={c('canvas')} style={{ width: layout.width, height: layout.height }}>
        <svg className={c('edges')} width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            <marker id="graph-workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" />
            </marker>
          </defs>
          {nodes.flatMap(node => node.dependsOn.map(dependency => {
            const from = layout.positions.get(dependency)
            const to = layout.positions.get(node.id)
            if (from === undefined || to === undefined) return null
            const x1 = from.x + CARD_WIDTH
            const y1 = from.y + CARD_HEIGHT / 2
            const x2 = to.x
            const y2 = to.y + CARD_HEIGHT / 2
            const bend = Math.max(34, (x2 - x1) / 2)
            return (
              <path
                key={`${dependency}->${node.id}`}
                d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                markerEnd="url(#graph-workflow-arrow)"
              />
            )
          }))}
        </svg>
        {nodes.map(node => {
          const point = layout.positions.get(node.id) ?? { x: CANVAS_PAD, y: CANVAS_PAD }
          const nodeRun = status?.get(node.id)
          const classes = [c('nodeCard')]
          if (selected === node.id) classes.push(c('nodeSelected'))
          if (nodeRun !== undefined) classes.push(c(`status_${nodeRun.status}`))
          return (
            <button
              type="button"
              key={node.id}
              className={classes.join(' ')}
              style={{ left: point.x, top: point.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              onClick={() => { onSelect?.(node.id) }}
            >
              <span className={c('nodeHead')}>
                <span className={c('nodeName')}>{node.name}</span>
                {outputNode === node.id ? <span className={c('outputBadge')}>OUTPUT</span> : null}
              </span>
              <span className={c('nodeId')}>{node.id}</span>
              <span className={c('nodePrompt')}>{nodeRun?.error?.message ?? node.prompt}</span>
              <span className={c('nodeMeta')}>
                {nodeRun?.status ?? ([node.skill, node.llm?.model].filter(Boolean).join(' · ') || 'default LLM')}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  multiline?: boolean
  placeholder?: string
}): ReactNode {
  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => { onChange(event.target.value) }
  return (
    <label className={c('field')}>
      <span>{label}</span>
      {multiline
        ? <textarea value={value} disabled={disabled} placeholder={placeholder} rows={6} onChange={change} />
        : <input value={value} disabled={disabled} placeholder={placeholder} onChange={change} />}
    </label>
  )
}

function splitList(value: string): string[] | undefined {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length === 0 ? undefined : [...new Set(items)]
}

function replaceTemplateReference(
  source: string,
  namespace: 'input' | 'nodes',
  previous: string,
  next: string,
): string {
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(\\{\\{\\s*${namespace}\\.)${escaped}(\\s*\\}\\})`, 'g')
  return source.replace(pattern, (_whole, prefix: string, suffix: string) => `${prefix}${next}${suffix}`)
}

function NodeInspector({
  node,
  allNodes,
  isOutput,
  t,
  onChange,
  onRename,
  onDelete,
  onOutput,
}: {
  node: GraphWorkflowNode
  allNodes: readonly GraphWorkflowNode[]
  isOutput: boolean
  t: GraphWorkflowStudioProps['t']
  onChange: (node: GraphWorkflowNode) => void
  onRename: (id: string) => void
  onDelete: () => void
  onOutput: () => void
}): ReactNode {
  const patch = (change: Partial<GraphWorkflowNode>): void => { onChange({ ...node, ...change }) }
  const patchLlm = (field: 'provider' | 'model', value: string): void => {
    const route = { ...node.llm, [field]: value.trim() === '' ? undefined : value }
    const llm = route.provider === undefined && route.model === undefined
      ? undefined
      : { ...(route.provider === undefined ? {} : { provider: route.provider }), ...(route.model === undefined ? {} : { model: route.model }) }
    const { llm: _old, ...rest } = node
    onChange(llm === undefined ? rest : { ...rest, llm })
  }
  const patchAcceptance = (field: keyof GraphWorkflowAcceptance, value: number | readonly string[] | undefined): void => {
    const next = { ...node.acceptance, [field]: value }
    const acceptance: GraphWorkflowAcceptance = {
      ...(next.minChars === undefined ? {} : { minChars: next.minChars }),
      ...(next.mustInclude === undefined || next.mustInclude.length === 0 ? {} : { mustInclude: next.mustInclude }),
      ...(next.forbidden === undefined || next.forbidden.length === 0 ? {} : { forbidden: next.forbidden }),
    }
    const { acceptance: _old, ...rest } = node
    onChange(Object.keys(acceptance).length === 0 ? rest : { ...rest, acceptance })
  }
  return (
    <aside className={c('inspector')}>
      <h3>{t('nodeEditor')}</h3>
      <TextField label="Node ID" value={node.id} onChange={onRename} />
      <TextField label={t('name')} value={node.name} onChange={value => { patch({ name: value }) }} />
      <TextField label={t('description')} value={node.description ?? ''} onChange={value => {
        const { description: _old, ...rest } = node
        onChange(value.trim() === '' ? rest : { ...rest, description: value })
      }} />
      <TextField
        label={t('prompt')}
        value={node.prompt}
        multiline
        placeholder="Use {{input.field}} and {{nodes.upstream-node}}"
        onChange={value => { patch({ prompt: value }) }}
      />
      <TextField label={t('skill')} value={node.skill ?? ''} onChange={value => {
        const { skill: _old, ...rest } = node
        onChange(value.trim() === '' ? rest : { ...rest, skill: value })
      }} />
      <div className={c('twoColumns')}>
        <TextField label={t('provider')} value={node.llm?.provider ?? ''} onChange={value => { patchLlm('provider', value) }} />
        <TextField label={t('model')} value={node.llm?.model ?? ''} onChange={value => { patchLlm('model', value) }} />
      </div>
      <fieldset className={c('fieldset')}>
        <legend>{t('dependsOn')}</legend>
        {allNodes.filter(candidate => candidate.id !== node.id).map(candidate => (
          <label key={candidate.id} className={c('checkRow')}>
            <input
              type="checkbox"
              checked={node.dependsOn.includes(candidate.id)}
              onChange={(event) => {
                patch({
                  dependsOn: event.target.checked
                    ? [...node.dependsOn, candidate.id]
                    : node.dependsOn.filter(id => id !== candidate.id),
                })
              }}
            />
            <span>{candidate.name}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className={c('fieldset')}>
        <legend>{t('acceptance')}</legend>
        <TextField
          label={t('minChars')}
          value={node.acceptance?.minChars?.toString() ?? ''}
          onChange={value => {
            const parsed = Number.parseInt(value, 10)
            patchAcceptance('minChars', Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
          }}
        />
        <TextField
          label={t('mustInclude')}
          value={node.acceptance?.mustInclude?.join(', ') ?? ''}
          onChange={value => { patchAcceptance('mustInclude', splitList(value)) }}
        />
        <TextField
          label={t('forbidden')}
          value={node.acceptance?.forbidden?.join(', ') ?? ''}
          onChange={value => { patchAcceptance('forbidden', splitList(value)) }}
        />
      </fieldset>
      <label className={c('checkRow')}>
        <input type="radio" checked={isOutput} onChange={onOutput} />
        <span>{t('outputNode')}</span>
      </label>
      <button type="button" className={c('dangerButton')} disabled={allNodes.length === 1} onClick={onDelete}>
        {t('deleteNode')}
      </button>
    </aside>
  )
}

function errorText(result: Exclude<UiResult<unknown>, { ok: true }>): string {
  return result.kind === 'transport' ? `Transport: ${result.message}` : result.message
}

/** Complete visual editor and live execution surface. */
export function GraphWorkflowStudio(props: GraphWorkflowStudioProps): ReactNode {
  const { t } = props
  const [tab, setTab] = useState<'design' | 'run'>('design')
  const [catalog, setCatalog] = useState<GraphWorkflowCatalog>()
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState<GraphWorkflowDraft>()
  const [expectedRevision, setExpectedRevision] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [runInput, setRunInput] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<GraphWorkflowRunSnapshot[]>([])
  const [starting, setStarting] = useState(false)
  const launchController = useRef<AbortController>()
  const selection = useRef<{ selectedId?: string; dirty: boolean }>({ dirty: false })
  const pollInFlight = useRef(false)
  selection.current = { ...(selectedId === undefined ? {} : { selectedId }), dirty }

  const selectDefinition = useCallback((definition: GraphWorkflowDefinition): void => {
    setSelectedId(definition.id)
    setDraft(editable(definition))
    setExpectedRevision(definition.revision)
    setSelectedNode(definition.nodes[0]?.id)
    setDirty(false)
    setMessage(undefined)
    setRunInput(Object.fromEntries(definition.inputs.map(input => [input.key, input.defaultValue ?? ''])))
  }, [])

  const loadCatalog = useCallback(async (): Promise<void> => {
    const result = await props.catalog()
    if (!result.ok) {
      setMessage(errorText(result))
      return
    }
    setCatalog(result.value)
    const current = selection.current
    const next = result.value.workflows.find(workflow => workflow.id === current.selectedId) ?? result.value.workflows[0]
    if (next !== undefined && !current.dirty) selectDefinition(next)
  }, [props.catalog, selectDefinition])

  useEffect(() => { void loadCatalog() }, [loadCatalog])
  useEffect(() => () => { launchController.current?.abort(new Error('Graph Workflow UI unmounted')) }, [])

  const pollRuns = useCallback(async (): Promise<void> => {
    if (pollInFlight.current) return
    pollInFlight.current = true
    try {
      const result = await props.runs()
      if (result.ok) setRuns([...result.value.runs])
    } finally {
      pollInFlight.current = false
    }
  }, [props.runs])

  useEffect(() => {
    void pollRuns()
    const timer = window.setInterval(() => { void pollRuns() }, 900)
    return () => { window.clearInterval(timer) }
  }, [pollRuns])

  const mutateDraft = (change: (current: GraphWorkflowDraft) => GraphWorkflowDraft): void => {
    setDraft(current => current === undefined ? current : change(current))
    setDirty(true)
    setMessage(undefined)
  }

  const activeDefinition = catalog?.workflows.find(workflow => workflow.id === selectedId)
  const currentNode = draft?.nodes.find(node => node.id === selectedNode)

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    setSaving(true)
    setMessage(undefined)
    const result = await props.save({ workflow: draft, expectedRevision })
    setSaving(false)
    if (!result.ok) {
      setMessage(errorText(result))
      return
    }
    setExpectedRevision(result.value.revision)
    setSelectedId(result.value.id)
    setDraft(editable(result.value))
    setDirty(false)
    setCatalog(current => current === undefined
      ? { revision: 0, workflows: [result.value] }
      : {
          revision: current.revision + 1,
          workflows: [...current.workflows.filter(workflow => workflow.id !== result.value.id), result.value],
        })
    setMessage(`Saved revision ${String(result.value.revision)}`)
  }

  const remove = async (): Promise<void> => {
    if (draft === undefined || expectedRevision === 0 || !window.confirm(t('confirmDelete'))) return
    const result = await props.remove({ workflowId: draft.id, expectedRevision })
    if (!result.ok) {
      setMessage(errorText(result))
      return
    }
    const remaining = catalog?.workflows.filter(workflow => workflow.id !== draft.id) ?? []
    setCatalog(current => ({ revision: (current?.revision ?? 0) + 1, workflows: remaining }))
    const next = remaining[0]
    if (next === undefined) {
      const created = newWorkflow({ revision: 0, workflows: [] })
      setSelectedId(created.id)
      setDraft(created)
      setExpectedRevision(0)
      setSelectedNode(created.nodes[0]?.id)
      setDirty(true)
    } else selectDefinition(next)
  }

  const addNode = (): void => {
    if (draft === undefined) return
    let sequence = draft.nodes.length + 1
    while (draft.nodes.some(node => node.id === `node-${String(sequence)}`)) sequence += 1
    const node: GraphWorkflowNode = {
      id: `node-${String(sequence)}`,
      name: `Node ${String(sequence)}`,
      dependsOn: draft.nodes.length === 0 ? [] : [draft.nodes.at(-1)?.id as string],
      prompt: 'Describe what this node must produce.',
    }
    mutateDraft(current => ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedNode(node.id)
  }

  const updateNode = (updated: GraphWorkflowNode): void => {
    mutateDraft(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === updated.id ? updated : node),
    }))
  }

  const renameNode = (nextId: string): void => {
    if (draft === undefined || currentNode === undefined) return
    const previous = currentNode.id
    mutateDraft(current => ({
      ...current,
      outputNode: current.outputNode === previous ? nextId : current.outputNode,
      nodes: current.nodes.map(node => node.id === previous
        ? { ...node, id: nextId }
        : {
            ...node,
            dependsOn: node.dependsOn.map(id => id === previous ? nextId : id),
            prompt: replaceTemplateReference(node.prompt, 'nodes', previous, nextId),
          }),
    }))
    setSelectedNode(nextId)
  }

  const start = async (): Promise<void> => {
    if (activeDefinition === undefined) {
      setMessage(t('unsavedHint'))
      return
    }
    launchController.current?.abort(new Error('superseded Graph Workflow launch'))
    const controller = new AbortController()
    launchController.current = controller
    setStarting(true)
    setMessage(undefined)
    const result = await props.start({ workflowId: activeDefinition.id, input: runInput }, controller.signal)
    if (launchController.current === controller) launchController.current = undefined
    setStarting(false)
    if (!result.ok) {
      setMessage(result.kind === 'no-session' ? t('noSession') : errorText(result))
      return
    }
    setMessage(`Run ${result.value.runId} started`)
    await pollRuns()
  }

  return (
    <div className={c('studio')}>
      <header className={c('hero')}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={c('tabs')} role="tablist">
          <button type="button" className={tab === 'design' ? c('tabActive') : ''} onClick={() => { setTab('design') }}>{t('design')}</button>
          <button type="button" className={tab === 'run' ? c('tabActive') : ''} onClick={() => { setTab('run') }}>{t('run')}</button>
        </div>
      </header>
      {message === undefined ? null : <div className={c('notice')} role="status">{message}</div>}
      <div className={c('body')}>
        <aside className={c('catalog')}>
          <button type="button" className={c('primaryButton')} onClick={() => {
            const created = newWorkflow(catalog)
            setSelectedId(created.id)
            setDraft(created)
            setExpectedRevision(0)
            setSelectedNode(created.nodes[0]?.id)
            setDirty(true)
            setRunInput({ brief: '' })
          }}>{`＋ ${t('newWorkflow')}`}</button>
          {catalog === undefined ? <p>{t('loading')}</p> : null}
          {catalog?.workflows.map(workflow => (
            <button
              type="button"
              key={workflow.id}
              className={`${c('catalogItem')} ${selectedId === workflow.id ? c('catalogItemActive') : ''}`}
              onClick={() => { selectDefinition(workflow) }}
            >
              <strong>{workflow.name}</strong>
              <span>{workflow.description}</span>
              <small>{`${workflow.nodes.length} nodes · r${workflow.revision}`}</small>
            </button>
          ))}
        </aside>

        {tab === 'design'
          ? draft === undefined
            ? <main className={c('empty')}>{t('empty')}</main>
            : (
              <main className={c('workspace')}>
                <section className={c('toolbar')}>
                  <span className={dirty ? c('dirty') : c('clean')}>{dirty ? '● Unsaved' : `Revision ${String(expectedRevision)}`}</span>
                  <button type="button" onClick={addNode}>{`＋ ${t('addNode')}`}</button>
                  <button type="button" onClick={() => { void loadCatalog() }}>{t('refresh')}</button>
                  <button type="button" className={c('dangerButton')} disabled={expectedRevision === 0} onClick={() => { void remove() }}>{t('remove')}</button>
                  <button type="button" className={c('primaryButton')} disabled={saving} onClick={() => { void save() }}>
                    {saving ? t('saving') : t('save')}
                  </button>
                </section>
                <div className={c('editorGrid')}>
                  <div className={c('editorMain')}>
                    <section className={c('panel')}>
                      <h2>{t('workflowInfo')}</h2>
                      <div className={c('twoColumns')}>
                        <TextField label={t('workflowId')} value={draft.id} disabled={expectedRevision > 0} onChange={value => { mutateDraft(current => ({ ...current, id: value })) }} />
                        <TextField label={t('name')} value={draft.name} onChange={value => { mutateDraft(current => ({ ...current, name: value })) }} />
                      </div>
                      <TextField label={t('description')} value={draft.description} onChange={value => { mutateDraft(current => ({ ...current, description: value })) }} />
                    </section>
                    <section className={c('panel')}>
                      <div className={c('sectionHead')}>
                        <h2>{t('requiredInputs')}</h2>
                        <button type="button" onClick={() => {
                          const item: GraphWorkflowInputDefinition = { key: `field_${String(draft.inputs.length + 1)}`, label: 'Field', required: false }
                          mutateDraft(current => ({ ...current, inputs: [...current.inputs, item] }))
                        }}>{`＋ ${t('addInput')}`}</button>
                      </div>
                      <div className={c('inputRows')}>
                        {draft.inputs.map((input, index) => (
                          <div key={`${String(index)}:${input.key}`} className={c('inputRow')}>
                            <input aria-label={t('key')} value={input.key} onChange={event => {
                              const key = event.target.value
                              mutateDraft(current => ({
                                ...current,
                                inputs: current.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, key } : item),
                                nodes: current.nodes.map(node => ({
                                  ...node,
                                  prompt: replaceTemplateReference(node.prompt, 'input', input.key, key),
                                })),
                              }))
                            }} />
                            <input aria-label={t('label')} value={input.label} onChange={event => {
                              const label = event.target.value
                              mutateDraft(current => ({ ...current, inputs: current.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, label } : item) }))
                            }} />
                            <input aria-label={t('defaultValue')} placeholder={t('defaultValue')} value={input.defaultValue ?? ''} onChange={event => {
                              const value = event.target.value
                              mutateDraft(current => ({
                                ...current,
                                inputs: current.inputs.map((item, itemIndex) => {
                                  if (itemIndex !== index) return item
                                  const { defaultValue: _old, ...rest } = item
                                  return value === '' ? rest : { ...rest, defaultValue: value }
                                }),
                              }))
                            }} />
                            <label className={c('compactCheck')}>
                              <input type="checkbox" checked={input.required} onChange={event => {
                                const required = event.target.checked
                                mutateDraft(current => ({ ...current, inputs: current.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, required } : item) }))
                              }} />
                              {t('required')}
                            </label>
                            <button type="button" aria-label={t('remove')} onClick={() => {
                              mutateDraft(current => ({ ...current, inputs: current.inputs.filter((_item, itemIndex) => itemIndex !== index) }))
                            }}>×</button>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className={c('panel')}>
                      <h2>{t('dagCanvas')}</h2>
                      <DagCanvas
                        nodes={draft.nodes}
                        outputNode={draft.outputNode}
                        {...selectedNode === undefined ? {} : { selected: selectedNode }}
                        onSelect={setSelectedNode}
                      />
                    </section>
                  </div>
                  {currentNode === undefined
                    ? <aside className={c('inspector')}><h3>{t('nodeEditor')}</h3><p>{t('selectNode')}</p></aside>
                    : (
                      <NodeInspector
                        node={currentNode}
                        allNodes={draft.nodes}
                        isOutput={draft.outputNode === currentNode.id}
                        t={t}
                        onChange={updateNode}
                        onRename={renameNode}
                        onOutput={() => { mutateDraft(current => ({ ...current, outputNode: currentNode.id })) }}
                        onDelete={() => {
                          mutateDraft(current => {
                            const nodes = current.nodes.filter(node => node.id !== currentNode.id).map(node => ({
                              ...node,
                              dependsOn: node.dependsOn.filter(id => id !== currentNode.id),
                            }))
                            return { ...current, nodes, outputNode: current.outputNode === currentNode.id ? nodes[0]?.id ?? '' : current.outputNode }
                          })
                          setSelectedNode(draft.nodes.find(node => node.id !== currentNode.id)?.id)
                        }}
                      />
                    )}
                </div>
              </main>
            )
          : (
            <main className={c('runWorkspace')}>
              <section className={c('panel')}>
                <div className={c('sectionHead')}>
                  <div>
                    <h2>{activeDefinition?.name ?? t('run')}</h2>
                    <p>{activeDefinition?.description ?? t('unsavedHint')}</p>
                  </div>
                  <button type="button" className={c('primaryButton')} disabled={starting || activeDefinition === undefined} onClick={() => { void start() }}>
                    {starting ? t('executing') : t('execute')}
                  </button>
                </div>
                {activeDefinition === undefined ? null : (
                  <div className={c('runForm')}>
                    {activeDefinition.inputs.map(input => (
                      <TextField
                        key={input.key}
                        label={`${input.label}${input.required ? ' *' : ''}`}
                        value={runInput[input.key] ?? input.defaultValue ?? ''}
                        multiline={input.key === 'brief' || input.key === 'selling_points'}
                        onChange={value => { setRunInput(current => ({ ...current, [input.key]: value })) }}
                      />
                    ))}
                  </div>
                )}
                <p className={c('hint')}>{t('unsavedHint')}</p>
              </section>
              <section className={c('runsSection')}>
                <div className={c('sectionHead')}>
                  <h2>{t('runs')}</h2>
                  <button type="button" onClick={() => { void pollRuns() }}>{t('refresh')}</button>
                </div>
                {runs.length === 0 ? <p>{t('noRuns')}</p> : runs.slice(0, 12).map(run => {
                  const definition = catalog?.workflows.find(workflow => workflow.id === run.workflowId)
                  const status = new Map(run.nodes.map(node => [node.nodeId, node]))
                  return (
                    <article key={run.runId} className={c('runCard')}>
                      <div className={c('runHead')}>
                        <div>
                          <strong>{run.workflowName}</strong>
                          <span>{`${run.status} · r${String(run.workflowRevision)} · ${new Date(run.createdAt).toLocaleString()}`}</span>
                        </div>
                        {run.status === 'running' || run.status === 'queued'
                          ? <button type="button" className={c('dangerButton')} onClick={() => { void props.cancel(run.runId).then(pollRuns) }}>{t('cancel')}</button>
                          : null}
                      </div>
                      {definition === undefined
                        ? (
                          <ol className={c('nodeList')}>
                            {run.nodes.map(node => <li key={node.nodeId}>{`${node.name}: ${node.status}`}</li>)}
                          </ol>
                        )
                        : <DagCanvas nodes={definition.nodes} outputNode={definition.outputNode} status={status} />}
                      {run.error === undefined ? null : <p className={c('error')} role="alert">{`${run.error.code}: ${run.error.message}`}</p>}
                      {run.deliverable === undefined ? null : (
                        <details className={c('deliverable')} open>
                          <summary>{t('deliverable')}</summary>
                          <pre>{run.deliverable}</pre>
                        </details>
                      )}
                    </article>
                  )
                })}
              </section>
            </main>
          )}
      </div>
    </div>
  )
}
