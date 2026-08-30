import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GraphWorkflowAcceptance,
  GraphWorkflowCapabilityCatalog,
  GraphWorkflowCatalog,
  GraphWorkflowDefinition,
  GraphWorkflowDraft,
  GraphWorkflowInputDefinition,
  GraphWorkflowNode,
  GraphWorkflowNodeRunSnapshot,
  GraphWorkflowRunCatalog,
  GraphWorkflowRunReceipt,
  GraphWorkflowRunSnapshot,
  GraphWorkflowRunStatus,
  GraphWorkflowTestCase,
  GraphWorkflowTestCaseCatalog,
  GraphWorkflowTestCasesRequest,
  GraphWorkflowVersionCatalog,
  GraphWorkflowVersion,
  GraphWorkflowVersionsRequest,
  GraphWorkflowWorkspaceRequest,
  PublishGraphWorkflowRequest,
  RemoveGraphWorkflowTestCaseRequest,
  RemoveGraphWorkflowRequest,
  RestoreGraphWorkflowRequest,
  SaveGraphWorkflowTestCaseRequest,
  SaveGraphWorkflowRequest,
  StartGraphWorkflowRequest,
} from 'dsh-graph-workflow/types'
import styles from './GraphWorkflowStudio.module.css'

/** UI-level result preserving domain rejection versus transport failure. */
export type UiResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false
    readonly kind: 'domain' | 'transport' | 'no-session'
    readonly message: string
    readonly code?: string
  }

/** Browser actions injected by the registration layer. */
export interface GraphWorkflowStudioInjected {
  catalog: (request: GraphWorkflowWorkspaceRequest) => Promise<UiResult<GraphWorkflowCatalog>>
  versions: (request: GraphWorkflowVersionsRequest) => Promise<UiResult<GraphWorkflowVersionCatalog>>
  save: (request: SaveGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  publish: (request: PublishGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  restore: (request: RestoreGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  remove: (request: RemoveGraphWorkflowRequest) => Promise<UiResult<GraphWorkflowDefinition>>
  capabilities: () => Promise<UiResult<GraphWorkflowCapabilityCatalog>>
  testCases: (request: GraphWorkflowTestCasesRequest) => Promise<UiResult<GraphWorkflowTestCaseCatalog>>
  saveTestCase: (request: SaveGraphWorkflowTestCaseRequest) => Promise<UiResult<GraphWorkflowTestCase>>
  removeTestCase: (request: RemoveGraphWorkflowTestCaseRequest) => Promise<UiResult<GraphWorkflowTestCase>>
  start: (request: StartGraphWorkflowRequest, signal: AbortSignal) => Promise<UiResult<GraphWorkflowRunReceipt>>
  runs: () => Promise<UiResult<GraphWorkflowRunCatalog>>
  cancel: (runId: string) => Promise<UiResult<GraphWorkflowRunSnapshot>>
}

export type GraphWorkflowInitialView = 'hub' | 'design' | 'test' | 'runs' | 'new'

/** Product workbench props supplied by the Workspace-owned section shell. */
export type GraphWorkflowStudioProps =
  PropsLocale<'graphWorkflow'>
  & InjectFace<GraphWorkflowStudioInjected>
  & {
    workspaceId: string
    workspaceTitle: string
    sessionReady: boolean
    initialWorkflowId?: string
    initialView?: GraphWorkflowInitialView
    onCatalogChange?: (catalog: GraphWorkflowCatalog) => void
    onDirtyChange?: (dirty: boolean) => void
  }

interface Point { readonly x: number; readonly y: number }
interface Layout { readonly positions: ReadonlyMap<string, Point>; readonly width: number; readonly height: number }

const CARD_WIDTH = 208
const CARD_HEIGHT = 126
const COLUMN_GAP = 48
const ROW_GAP = 32
const CANVAS_PAD = 32
const INPUT_NODE_ID = '__workflow-input__'

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

function newWorkflow(catalog: GraphWorkflowCatalog | undefined, t: GraphWorkflowStudioProps['t']): GraphWorkflowDraft {
  let suffix = (catalog?.workflows.length ?? 0) + 1
  while (catalog?.workflows.some(workflow => workflow.id === `workflow-${String(suffix)}`) === true) suffix += 1
  return {
    id: `workflow-${String(suffix)}`,
    name: t('newWorkflowName'),
    description: t('newWorkflowDescription'),
    inputs: [{ key: 'brief', label: t('newWorkflowInput'), required: true }],
    nodes: [{
      id: 'draft',
      name: t('newWorkflowNode'),
      dependsOn: [],
      prompt: t('newWorkflowPrompt'),
    }],
    outputNode: 'draft',
  }
}

function uniqueWorkflowId(catalog: GraphWorkflowCatalog | undefined, sourceId: string): string {
  const known = new Set(catalog?.workflows.map(workflow => workflow.id) ?? [])
  const base = `${sourceId.slice(0, 54).replace(/-+$/g, '')}-copy`
  if (!known.has(base)) return base
  let sequence = 2
  let candidate = `${base}-${String(sequence)}`
  while (known.has(candidate)) {
    sequence += 1
    candidate = `${base.slice(0, 62 - String(sequence).length)}-${String(sequence)}`
  }
  return candidate
}

function slugId(value: string, fallback: string): string {
  const normalized = value.toLocaleLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized === '' ? fallback : normalized
}

function layersOf(nodes: readonly GraphWorkflowNode[]): string[][] {
  const known = new Set(nodes.map(node => node.id))
  const emitted = new Set<string>()
  const layers: string[][] = []
  while (emitted.size < nodes.length) {
    const ready = nodes
      .filter(node => !emitted.has(node.id)
        && node.dependsOn.filter(id => known.has(id)).every(id => emitted.has(id)))
      .map(node => node.id)
    if (ready.length === 0) {
      layers.push(nodes.filter(node => !emitted.has(node.id)).map(node => node.id))
      break
    }
    ready.forEach(id => { emitted.add(id) })
    layers.push(ready)
  }
  return layers
}

function automaticLayoutOf(nodes: readonly GraphWorkflowNode[]): Layout {
  const layers = layersOf(nodes)
  const positions = new Map<string, Point>()
  const maximumRows = Math.max(1, ...layers.map(layer => layer.length))
  const totalHeight = maximumRows * CARD_HEIGHT + Math.max(0, maximumRows - 1) * ROW_GAP
  positions.set(INPUT_NODE_ID, { x: CANVAS_PAD, y: CANVAS_PAD + (totalHeight - CARD_HEIGHT) / 2 })
  for (const [column, layer] of layers.entries()) {
    const layerHeight = layer.length * CARD_HEIGHT + Math.max(0, layer.length - 1) * ROW_GAP
    const offset = CANVAS_PAD + (totalHeight - layerHeight) / 2
    for (const [row, id] of layer.entries()) {
      positions.set(id, {
        x: CANVAS_PAD + (column + 1) * (CARD_WIDTH + COLUMN_GAP),
        y: offset + row * (CARD_HEIGHT + ROW_GAP),
      })
    }
  }
  return {
    positions,
    width: Math.max(720, CANVAS_PAD * 2 + (layers.length + 1) * CARD_WIDTH + layers.length * COLUMN_GAP),
    height: Math.max(360, CANVAS_PAD * 2 + totalHeight),
  }
}

function layoutOf(nodes: readonly GraphWorkflowNode[]): Layout {
  const automatic = automaticLayoutOf(nodes)
  const positions = new Map(automatic.positions)
  for (const node of nodes) {
    if (node.position !== undefined) positions.set(node.id, node.position)
  }
  const points = [...positions.values()]
  return {
    positions,
    width: Math.max(automatic.width, ...points.map(point => point.x + CARD_WIDTH + CANVAS_PAD)),
    height: Math.max(automatic.height, ...points.map(point => point.y + CARD_HEIGHT + CANVAS_PAD)),
  }
}

function statusText(t: GraphWorkflowStudioProps['t'], status: GraphWorkflowRunStatus | GraphWorkflowNodeRunSnapshot['status']): string {
  return t(status)
}

function statusClass(status: GraphWorkflowRunStatus | GraphWorkflowNodeRunSnapshot['status']): string {
  return c(`status_${status}`)
}

function errorText(result: Exclude<UiResult<unknown>, { ok: true }>): string {
  return result.kind === 'transport' ? `Transport: ${result.message}` : result.message
}

function splitList(value: string): string[] | undefined {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length === 0 ? undefined : [...new Set(items)]
}

function replaceTemplateReference(source: string, namespace: 'input' | 'nodes', previous: string, next: string): string {
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.replace(
    new RegExp(`(\\{\\{\\s*${namespace}\\.)${escaped}(\\s*\\}\\})`, 'g'),
    (_whole, prefix: string, suffix: string) => `${prefix}${next}${suffix}`,
  )
}

function ancestorsOf(node: GraphWorkflowNode, nodes: readonly GraphWorkflowNode[]): string[] {
  const byId = new Map(nodes.map(candidate => [candidate.id, candidate]))
  const result = new Set<string>()
  const visit = (id: string): void => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (result.has(dependency)) continue
      result.add(dependency)
      visit(dependency)
    }
  }
  visit(node.id)
  return [...result]
}

function hasValidInputDefinition(input: GraphWorkflowInputDefinition): boolean {
  const type = input.type ?? 'text'
  if (!['text', 'multiline', 'number', 'boolean', 'select'].includes(type)) return false
  if (type === 'select' && (input.options === undefined || input.options.length === 0 || new Set(input.options).size !== input.options.length)) return false
  if (type !== 'select' && input.options !== undefined) return false
  if (input.defaultValue !== undefined && type === 'number' && !Number.isFinite(Number(input.defaultValue))) return false
  if (input.defaultValue !== undefined && type === 'boolean' && input.defaultValue !== 'true' && input.defaultValue !== 'false') return false
  return input.defaultValue === undefined || type !== 'select' || input.options?.includes(input.defaultValue) === true
}

/** Fast browser-side structure check; the Host remains authoritative on save. */
function hasValidStructure(draft: GraphWorkflowDraft): boolean {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id)
    || draft.name.trim() === '' || draft.description.trim() === '' || draft.nodes.length === 0) return false
  const inputKeys = draft.inputs.map(input => input.key)
  if (new Set(inputKeys).size !== inputKeys.length
    || draft.inputs.some(input => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(input.key) || input.label.trim() === '' || !hasValidInputDefinition(input))) return false
  const nodeIds = draft.nodes.map(node => node.id)
  const knownNodes = new Set(nodeIds)
  if (new Set(nodeIds).size !== nodeIds.length || !knownNodes.has(draft.outputNode)
    || draft.nodes.some(node => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(node.id)
      || node.name.trim() === '' || node.prompt.trim() === ''
      || new Set(node.dependsOn).size !== node.dependsOn.length
      || node.dependsOn.some(id => id === node.id || !knownNodes.has(id)))) return false
  const emitted = new Set<string>()
  while (emitted.size < draft.nodes.length) {
    const ready = draft.nodes.filter(node => !emitted.has(node.id) && node.dependsOn.every(id => emitted.has(id)))
    if (ready.length === 0) return false
    ready.forEach(node => { emitted.add(node.id) })
  }
  const knownInputs = new Set(inputKeys)
  for (const node of draft.nodes) {
    const ancestors = new Set(ancestorsOf(node, draft.nodes))
    for (const match of node.prompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const reference = match[1] as string
      if (reference === 'input') continue
      if (reference.startsWith('input.') && knownInputs.has(reference.slice('input.'.length))) continue
      if (reference.startsWith('nodes.') && ancestors.has(reference.slice('nodes.'.length))) continue
      return false
    }
  }
  return true
}

function TextField({
  label, value, onChange, disabled = false, multiline = false, placeholder, rows = 4, suggestions,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  multiline?: boolean
  placeholder?: string
  rows?: number
  suggestions?: readonly { readonly value: string; readonly label?: string }[]
}): ReactNode {
  const listId = useId()
  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => { onChange(event.target.value) }
  return (
    <label className={c('field')}>
      <span>{label}</span>
      {multiline
        ? <textarea aria-label={label} value={value} disabled={disabled} placeholder={placeholder} rows={rows} onChange={change} />
        : <><input aria-label={label} value={value} disabled={disabled} placeholder={placeholder} {...suggestions === undefined ? {} : { list: listId }} onChange={change} />{suggestions !== undefined && <datalist id={listId}>{suggestions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist>}</>}
    </label>
  )
}

function DagCanvas({ nodes, inputs, outputNode, selected, status, onSelect, onMove, onConnect, onDeleteEdge, onDeleteNode, t, compact = false, resetKey = 0 }: {
  nodes: readonly GraphWorkflowNode[]
  inputs: readonly GraphWorkflowInputDefinition[]
  outputNode: string
  selected?: string
  status?: ReadonlyMap<string, GraphWorkflowNodeRunSnapshot>
  onSelect?: (id: string) => void
  onMove?: (id: string, position: Point) => void
  onConnect?: (sourceId: string, targetId: string) => void
  onDeleteEdge?: (sourceId: string, targetId: string) => void
  onDeleteNode?: (id: string) => void
  t: GraphWorkflowStudioProps['t']
  compact?: boolean
  resetKey?: number
}): ReactNode {
  const markerId = useId().replaceAll(':', '')
  const viewport = useRef<HTMLDivElement | null>(null)
  const defaultZoom = compact ? .8 : .92
  const [zoom, setZoom] = useState(defaultZoom)
  const [fitZoom, setFitZoom] = useState(defaultZoom)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [connectingFrom, setConnectingFrom] = useState<string>()
  const [selectedEdge, setSelectedEdge] = useState<{ sourceId: string; targetId: string }>()
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; origin: Point; point: Point }>()
  const layout = useMemo(() => layoutOf(nodes), [nodes])
  useEffect(() => {
    const fit = (): void => {
      const width = viewport.current?.clientWidth ?? 0
      const height = viewport.current?.clientHeight ?? 0
      if (width <= 0 || height <= 0) return
      setViewportSize({ width, height })
      const next = Math.min(1, Math.max(compact ? .68 : .72, Math.min(
        (width - 48) / layout.width,
        (height - 48) / layout.height,
      )))
      setFitZoom(next)
      setZoom(next)
    }
    fit()
    if (typeof ResizeObserver === 'undefined' || viewport.current === null) return
    const observer = new ResizeObserver(fit)
    observer.observe(viewport.current)
    return () => { observer.disconnect() }
  }, [compact, layout.height, layout.width, resetKey])
  const roots = nodes.filter(node => node.dependsOn.length === 0)
  const input = layout.positions.get(INPUT_NODE_ID) as Point
  const pointOf = (id: string): Point | undefined => drag?.id === id ? drag.point : layout.positions.get(id)
  const activatePort = (event: ReactKeyboardEvent, action: () => void): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }
  const deleteSelectedEdge = (): void => {
    if (selectedEdge === undefined) return
    onDeleteEdge?.(selectedEdge.sourceId, selectedEdge.targetId)
    setSelectedEdge(undefined)
  }
  const edge = (from: Point, to: Point): string => {
    const x1 = from.x + CARD_WIDTH
    const y1 = from.y + CARD_HEIGHT / 2
    const x2 = to.x
    const y2 = to.y + CARD_HEIGHT / 2
    const bend = Math.max(30, (x2 - x1) / 2)
    return `M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`
  }
  const scaledStyle = {
    width: layout.width * zoom,
    height: layout.height * zoom,
    '--graph-zoom': String(zoom),
  } as CSSProperties
  const canvasStyle = {
    width: layout.width,
    height: layout.height,
    left: Math.max(0, (viewportSize.width - layout.width * zoom) / 2),
    top: Math.max(0, (viewportSize.height - layout.height * zoom) / 2),
  }
  return (
    <div ref={viewport} className={`${c('canvasViewport')} ${compact ? c('canvasCompact') : ''}`} onKeyDown={event => { if (event.key === 'Escape' && connectingFrom !== undefined) { setConnectingFrom(undefined); return } if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdge !== undefined) { event.preventDefault(); deleteSelectedEdge() } }}>
      <div className={c('canvasScale')} style={scaledStyle}>
        <div className={c('canvas')} style={canvasStyle}>
          <svg className={c('edges')} width={layout.width} height={layout.height} aria-label={t('dagEdges')}>
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            {roots.map(node => {
              const to = pointOf(node.id)
              return to === undefined ? null : <path className={c('inputEdge')} aria-hidden="true" key={`input->${node.id}`} d={edge(input, to)} markerEnd={`url(#${markerId})`} />
            })}
            {nodes.flatMap(node => node.dependsOn.map(dependency => {
              const from = pointOf(dependency)
              const to = pointOf(node.id)
              if (from === undefined || to === undefined) return null
              const path = edge(from, to)
              const isSelected = selectedEdge?.sourceId === dependency && selectedEdge.targetId === node.id
              const selectEdge = (): void => { if (onDeleteEdge !== undefined) setSelectedEdge({ sourceId: dependency, targetId: node.id }) }
              return <g key={`${dependency}->${node.id}`}>
                <path className={c('edgeHit')} d={path} role={onDeleteEdge === undefined ? undefined : 'button'} tabIndex={onDeleteEdge === undefined ? -1 : 0} aria-label={t('edgeLabel', { from: nodes.find(item => item.id === dependency)?.name ?? dependency, to: node.name })} onClick={selectEdge} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectEdge() } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onDeleteEdge?.(dependency, node.id); setSelectedEdge(undefined) } }} />
                <path className={isSelected ? c('edgeSelected') : ''} aria-hidden="true" d={path} markerEnd={`url(#${markerId})`} />
              </g>
            }))}
          </svg>
          <div className={`${c('nodeCard')} ${c('inputNode')}`} style={{ left: input.x, top: input.y }}>
            <span className={c('nodeEyebrow')}>{t('inputNode')}</span>
            <strong>{inputs.length === 0 ? t('noInput') : t('fieldCount', { count: inputs.length })}</strong>
            <span>{inputs.map(item => item.key).join(' · ') || '—'}</span>
          </div>
          {nodes.map((node, index) => {
            const point = pointOf(node.id) ?? input
            const nodeRun = status?.get(node.id)
            const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
              if (onMove === undefined || event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, origin: point, point })
            }
            const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
              if (drag?.id !== node.id) return
              setDrag({
                ...drag,
                point: {
                  x: Math.min(100_000, Math.max(0, Math.round(drag.origin.x + (event.clientX - drag.startX) / zoom))),
                  y: Math.min(100_000, Math.max(0, Math.round(drag.origin.y + (event.clientY - drag.startY) / zoom))),
                },
              })
            }
            const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
              if (drag?.id !== node.id) return
              event.currentTarget.releasePointerCapture(event.pointerId)
              onMove?.(node.id, drag.point)
              setDrag(undefined)
            }
            return (
              <div
                key={node.id}
                className={[
                  c('nodeCard'),
                  outputNode === node.id ? c('outputCard') : '',
                  selected === node.id ? c('nodeSelected') : '',
                  connectingFrom === node.id ? c('nodeConnecting') : '',
                  nodeRun === undefined ? '' : statusClass(nodeRun.status),
                ].filter(Boolean).join(' ')}
                style={{ left: point.x, top: point.y }}
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => { setDrag(undefined) }}
              >
                {onConnect !== undefined && <span role="button" tabIndex={0} className={`${c('nodePort')} ${c('targetPort')}`} aria-label={t('connectTarget', { node: node.name })} onPointerDown={event => { event.stopPropagation() }} onClick={event => { event.stopPropagation(); if (connectingFrom !== undefined && connectingFrom !== node.id) { onConnect(connectingFrom, node.id); setConnectingFrom(undefined) } }} onKeyDown={event => { event.stopPropagation(); activatePort(event, () => { if (connectingFrom !== undefined && connectingFrom !== node.id) { onConnect(connectingFrom, node.id); setConnectingFrom(undefined) } }) }} />}
                <button type="button" className={c('nodeBody')} aria-pressed={selected === node.id} onClick={() => { setSelectedEdge(undefined); onSelect?.(node.id) }} onKeyDown={event => {
                  const step = event.shiftKey ? 1 : 10
                  const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 }
                    : event.key === 'ArrowRight' ? { x: step, y: 0 }
                      : event.key === 'ArrowUp' ? { x: 0, y: -step }
                        : event.key === 'ArrowDown' ? { x: 0, y: step }
                          : undefined
                  if (delta !== undefined && onMove !== undefined) {
                    event.preventDefault(); event.stopPropagation()
                    onMove(node.id, {
                      x: Math.min(100_000, Math.max(0, point.x + delta.x)),
                      y: Math.min(100_000, Math.max(0, point.y + delta.y)),
                    })
                  } else if ((event.key === 'Delete' || event.key === 'Backspace') && onDeleteNode !== undefined) {
                    event.preventDefault(); event.stopPropagation(); onDeleteNode(node.id)
                  }
                }}>
                  <span className={c('nodeTop')}>
                    <span className={c('nodeEyebrow')}>{`${String(index + 1).padStart(2, '0')} · ${outputNode === node.id ? t('outputNodeType') : t('aiTask')}`}</span>
                    {nodeRun === undefined ? <span>•••</span> : <span className={c('nodeState')}>{statusText(t, nodeRun.status)}</span>}
                  </span>
                  <strong className={c('nodeName')}>{node.name}</strong>
                  <span className={c('nodeSummary')}>{nodeRun?.error?.message ?? node.description ?? node.prompt}</span>
                  <span className={c('nodeBadges')}>
                    {node.skill !== undefined && <i>Skill</i>}
                    {node.llm?.model !== undefined && <i>{node.llm.model}</i>}
                    {node.acceptance !== undefined && <i>{t('ruleCount', { count: Object.keys(node.acceptance).length })}</i>}
                  </span>
                </button>
                {onConnect !== undefined && <span role="button" tabIndex={0} className={`${c('nodePort')} ${c('sourcePort')}`} aria-label={t('connectSource', { node: node.name })} aria-pressed={connectingFrom === node.id} onPointerDown={event => { event.stopPropagation() }} onClick={event => { event.stopPropagation(); setConnectingFrom(current => current === node.id ? undefined : node.id) }} onKeyDown={event => { event.stopPropagation(); activatePort(event, () => { setConnectingFrom(current => current === node.id ? undefined : node.id) }) }} />}
              </div>
            )
          })}
        </div>
      </div>
      {connectingFrom !== undefined && <div className={c('connectionHint')} role="status">{t('connectionHint', { node: nodes.find(node => node.id === connectingFrom)?.name ?? connectingFrom })}<button type="button" onClick={() => { setConnectingFrom(undefined) }}>{t('cancel')}</button></div>}
      <div className={c('canvasControls')} aria-label={t('canvasZoom')}>
        <button type="button" aria-label={t('zoomOut')} onClick={() => { setZoom(value => Math.max(.6, value - .1)) }}>−</button>
        <span>{`${Math.round(zoom * 100)}%`}</span>
        <button type="button" aria-label={t('zoomIn')} onClick={() => { setZoom(value => Math.min(1.25, value + .1)) }}>＋</button>
        <button type="button" aria-label={t('fitCanvas')} onClick={() => { setZoom(fitZoom) }}>⌗</button>
      </div>
      <div className={c('minimap')} aria-hidden="true">
        {nodes.map(node => {
          const point = pointOf(node.id) ?? input
          return <i key={node.id} style={{ left: `${8 + (point.x / layout.width) * 70}px`, top: `${7 + (point.y / layout.height) * 31}px` }} />
        })}
        <span />
      </div>
    </div>
  )
}

function NodeInspector({ node, allNodes, inputs, isOutput, capabilities, canTest, t, onChange, onRename, onDelete, onOutput, onTest }: {
  node: GraphWorkflowNode
  allNodes: readonly GraphWorkflowNode[]
  inputs: readonly GraphWorkflowInputDefinition[]
  isOutput: boolean
  capabilities?: GraphWorkflowCapabilityCatalog
  canTest: boolean
  t: GraphWorkflowStudioProps['t']
  onChange: (node: GraphWorkflowNode) => void
  onRename: (id: string) => void
  onDelete: () => void
  onOutput: () => void
  onTest: () => void
}): ReactNode {
  const [tab, setTab] = useState<'basic' | 'prompt' | 'capability' | 'acceptance'>('prompt')
  const patch = (change: Partial<GraphWorkflowNode>): void => { onChange({ ...node, ...change }) }
  const patchOptional = (field: 'description' | 'skill', value: string): void => {
    const rest = { ...node }
    delete rest[field]
    onChange(value.trim() === '' ? rest : { ...rest, [field]: value })
  }
  const patchLlm = (field: 'provider' | 'model', value: string): void => {
    const route = { ...node.llm, [field]: value.trim() === '' ? undefined : value }
    const rest = { ...node }
    delete rest.llm
    onChange(route.provider === undefined && route.model === undefined ? rest : {
      ...rest,
      llm: {
        ...(route.provider === undefined ? {} : { provider: route.provider }),
        ...(route.model === undefined ? {} : { model: route.model }),
      },
    })
  }
  const patchAcceptance = (field: keyof GraphWorkflowAcceptance, value: number | readonly string[] | undefined): void => {
    const next = { ...node.acceptance, [field]: value }
    const acceptance: GraphWorkflowAcceptance = {
      ...(next.minChars === undefined ? {} : { minChars: next.minChars }),
      ...(next.mustInclude === undefined || next.mustInclude.length === 0 ? {} : { mustInclude: next.mustInclude }),
      ...(next.forbidden === undefined || next.forbidden.length === 0 ? {} : { forbidden: next.forbidden }),
    }
    const rest = { ...node }
    delete rest.acceptance
    onChange(Object.keys(acceptance).length === 0 ? rest : { ...rest, acceptance })
  }
  const references = [
    ...inputs.map(input => ({ label: input.label, value: `{{input.${input.key}}}`, kind: 'in' })),
    ...ancestorsOf(node, allNodes).map(id => ({
      label: allNodes.find(candidate => candidate.id === id)?.name ?? id,
      value: `{{nodes.${id}}}`,
      kind: 'up',
    })),
  ]
  const provider = capabilities?.providers.find(item => item.id === node.llm?.provider)
  return (
    <aside className={c('inspector')}>
      <div className={c('inspectorHead')}>
        <span className={c('inspectorGlyph')}>✦</span>
        <span><strong>{node.name}</strong><small>{node.id}</small></span>
      </div>
      <div className={c('inspectorTabs')} role="tablist" aria-label={t('nodeSettings')}>
        {([
          ['basic', t('basic')],
          ['prompt', t('promptTab')],
          ['capability', t('capability')],
          ['acceptance', t('acceptance')],
        ] as const).map(([key, label]) => (
          <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? c('active') : ''} onClick={() => { setTab(key) }}>
            {label}{key === 'acceptance' && node.acceptance !== undefined ? <i>{Object.keys(node.acceptance).length}</i> : null}
          </button>
        ))}
      </div>
      <div className={c('inspectorBody')}>
        {tab === 'basic' && (
          <div className={c('formStack')}>
            <TextField label={t('nodeId')} value={node.id} onChange={onRename} />
            <TextField label={t('name')} value={node.name} onChange={value => { patch({ name: value }) }} />
            <TextField label={t('description')} value={node.description ?? ''} multiline rows={3} onChange={value => { patchOptional('description', value) }} />
            <fieldset className={c('fieldset')}>
              <legend>{t('dependsOn')}</legend>
              {allNodes.filter(candidate => candidate.id !== node.id).map(candidate => (
                <label key={candidate.id} className={c('checkRow')}>
                  <input type="checkbox" checked={node.dependsOn.includes(candidate.id)} onChange={event => {
                    patch({ dependsOn: event.target.checked
                      ? [...node.dependsOn, candidate.id]
                      : node.dependsOn.filter(id => id !== candidate.id) })
                  }} />
                  <span>{candidate.name}</span>
                </label>
              ))}
            </fieldset>
          </div>
        )}
        {tab === 'prompt' && (
          <div className={c('formStack')}>
            <TextField label={t('prompt')} value={node.prompt} multiline rows={12} onChange={value => { patch({ prompt: value }) }} />
            <div className={c('variablePanel')}>
              <strong>{t('variables')}</strong>
              {references.map(reference => (
                <button
                  type="button"
                  key={reference.value}
                  aria-label={t('insertVariable', { variable: reference.value })}
                  onClick={() => { patch({ prompt: `${node.prompt}${node.prompt.endsWith(' ') ? '' : ' '}${reference.value}` }) }}
                >
                  <i>{reference.kind}</i><span><b>{reference.value}</b><small>{reference.label}</small></span><em>＋</em>
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'capability' && (
          <div className={c('formStack')}>
            <TextField label={t('skill')} value={node.skill ?? ''} {...capabilities === undefined ? {} : { suggestions: capabilities.skills.map(skill => ({ value: skill.name, label: skill.description })) }} onChange={value => { patchOptional('skill', value) }} />
            <div className={c('settingGroup')}>
              <strong>{t('llmRoute')}</strong>
              <TextField label={t('provider')} value={node.llm?.provider ?? ''} {...capabilities === undefined ? {} : { suggestions: capabilities.providers.map(item => ({ value: item.id, label: item.name })) }} onChange={value => { patchLlm('provider', value) }} />
              <TextField label={t('model')} value={node.llm?.model ?? ''} {...provider === undefined ? {} : { suggestions: provider.models.map(model => ({ value: model.id, label: model.name })) }} onChange={value => { patchLlm('model', value) }} />
              <small>{t('inheritModel')}</small>
              {capabilities !== undefined && <small>{t('capabilityCount', { skills: capabilities.skills.length, providers: capabilities.providers.length })}</small>}
            </div>
          </div>
        )}
        {tab === 'acceptance' && (
          <div className={c('formStack')}>
            <div className={c('acceptanceIntro')}><span>✓</span><p><strong>{t('acceptanceRules')}</strong><small>{t('acceptanceGateHint')}</small></p></div>
            <TextField label={t('minChars')} value={node.acceptance?.minChars?.toString() ?? ''} onChange={value => {
              const parsed = Number.parseInt(value, 10)
              patchAcceptance('minChars', Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
            }} />
            <TextField label={t('mustInclude')} value={node.acceptance?.mustInclude?.join(', ') ?? ''} onChange={value => { patchAcceptance('mustInclude', splitList(value)) }} />
            <TextField label={t('forbidden')} value={node.acceptance?.forbidden?.join(', ') ?? ''} onChange={value => { patchAcceptance('forbidden', splitList(value)) }} />
          </div>
        )}
      </div>
      <div className={c('inspectorFooter')}>
        <button type="button" className={c('primaryButton')} disabled={!canTest} onClick={onTest}>▶ {t('testNode')}</button>
        <label className={c('outputChoice')}><input type="radio" checked={isOutput} onChange={onOutput} />{t('outputNode')}</label>
        <button type="button" className={c('dangerButton')} disabled={allNodes.length === 1} onClick={onDelete}>{t('deleteNode')}</button>
      </div>
    </aside>
  )
}

function WorkflowHub({ catalog, runs, query, t, onQuery, onNew, onOpen }: {
  catalog: GraphWorkflowCatalog | undefined
  runs: readonly GraphWorkflowRunSnapshot[]
  query: string
  t: GraphWorkflowStudioProps['t']
  onQuery: (value: string) => void
  onNew: () => void
  onOpen: (workflow: GraphWorkflowDefinition, view: 'design' | 'test') => void
}): ReactNode {
  const active = runs.filter(run => run.status === 'queued' || run.status === 'running').length
  const workflows = catalog?.workflows.filter(workflow => {
    const needle = query.trim().toLocaleLowerCase()
    return needle === '' || `${workflow.name} ${workflow.description} ${workflow.id}`.toLocaleLowerCase().includes(needle)
  }) ?? []
  return (
    <div className={c('hub')}>
      <header className={c('hubHeader')}>
        <div><h1>{t('hubTitle')}</h1><p>{t('hubSubtitle')}</p></div>
        <button type="button" className={c('primaryButton')} onClick={onNew}>＋ {t('newWorkflow')}</button>
      </header>
      <section className={c('hubHero')}>
        <div><span className={c('heroIcon')}>⌁</span><div><strong>{t('hubHeroTitle')}</strong><p>{t('hubHeroDescription')}</p><div className={c('heroSteps')}><span>{t('design')}</span><i>→</i><span>{t('acceptance')}</span><i>→</i><span>{t('run')}</span></div></div></div>
      </section>
      <section className={c('metricGrid')} aria-label={t('workflowMetrics')}>
        <article><span>◇</span><div><strong>{String(catalog?.workflows.length ?? 0)}</strong><small>{t('workflowCount')}</small></div></article>
        <article><span>↻</span><div><strong>{String(runs.length)}</strong><small>{t('runCount')}</small></div></article>
        <article><span>●</span><div><strong>{String(active)}</strong><small>{t('activeCount')}</small></div></article>
      </section>
      <div className={c('hubToolbar')}>
        <label className={c('searchBox')}><span>⌕</span><input aria-label={t('searchPlaceholder')} value={query} placeholder={t('searchPlaceholder')} onChange={event => { onQuery(event.target.value) }} /></label>
        <span>{t('processLocal')}</span>
      </div>
      {catalog === undefined ? <div className={c('emptyState')}>{t('loading')}</div> : workflows.length === 0 ? (
        <div className={c('emptyState')}><span>⌁</span><strong>{t('empty')}</strong><button type="button" onClick={onNew}>{t('newWorkflow')}</button></div>
      ) : (
        <section className={c('workflowGrid')}>
          {workflows.map(workflow => {
            const lastRun = runs.find(run => run.workflowId === workflow.id)
            return (
              <article key={workflow.id} className={c('workflowCard')}>
                <div className={c('workflowCardTop')}><span className={c('workflowGlyph')}>⌁</span><span className={c('publicationState')}>{workflow.publishedRevision === undefined ? t('draftStatus') : workflow.publishedRevision === workflow.revision ? t('publishedVersion') : t('productionRevision', { revision: workflow.publishedRevision })}</span><span className={c('revisionBadge')}>{`r${String(workflow.revision)}`}</span></div>
                <div className={c('workflowCardBody')}><h2>{workflow.name}</h2><p>{workflow.description}</p></div>
                <div className={c('workflowMeta')}><span>{t('nodeCount', { count: workflow.nodes.length })}</span><span>{lastRun === undefined ? t('notRun') : t('lastRunStatus', { status: statusText(t, lastRun.status) })}</span><time dateTime={new Date(workflow.updatedAt).toISOString()}>{t('updatedOn', { date: new Date(workflow.updatedAt).toISOString().slice(0, 10) })}</time></div>
                <div className={c('workflowActions')}>
                  <button type="button" onClick={() => { onOpen(workflow, 'design') }}>{t('openEditor')}</button>
                  <button type="button" className={c('primaryButton')} onClick={() => { onOpen(workflow, 'test') }}>▶ {t('testRun')}</button>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

function InputEditor({ draft, t, onChange }: {
  draft: GraphWorkflowDraft
  t: GraphWorkflowStudioProps['t']
  onChange: (draft: GraphWorkflowDraft) => void
}): ReactNode {
  const update = (index: number, next: GraphWorkflowInputDefinition): void => {
    onChange({ ...draft, inputs: draft.inputs.map((item, itemIndex) => itemIndex === index ? next : item) })
  }
  return (
    <div className={c('inputEditor')}>
      {draft.inputs.map((input, index) => (
        <div key={`${String(index)}:${input.key}`} className={c('inputEditorRow')}>
          <div className={c('inputEditorTop')}>
            <input aria-label={t('key')} value={input.key} onChange={event => {
              const key = event.target.value
              onChange({
                ...draft,
                inputs: draft.inputs.map((item, itemIndex) => itemIndex === index ? { ...item, key } : item),
                nodes: draft.nodes.map(node => ({ ...node, prompt: replaceTemplateReference(node.prompt, 'input', input.key, key) })),
              })
            }} />
            <input aria-label={t('label')} value={input.label} onChange={event => { update(index, { ...input, label: event.target.value }) }} />
            <button type="button" aria-label={`${t('remove')} ${input.label}`} onClick={() => {
              onChange({ ...draft, inputs: draft.inputs.filter((_item, itemIndex) => itemIndex !== index) })
            }}>×</button>
          </div>
          <div className={c('inputEditorOptions')}>
            <label><span>{t('inputType')}</span><select aria-label={`${t('inputType')} ${input.label}`} value={input.type ?? 'text'} onChange={event => {
              const type = event.target.value as NonNullable<GraphWorkflowInputDefinition['type']>
              const { options: _options, defaultValue: _defaultValue, type: _type, ...base } = input
              const next: GraphWorkflowInputDefinition = {
                ...base,
                type,
                ...(type === 'select' ? { options: input.options ?? [t('newOption')], defaultValue: input.options?.[0] ?? t('newOption') } : {}),
                ...(type === 'boolean' ? { defaultValue: input.defaultValue === 'true' ? 'true' : 'false' } : {}),
                ...(type === 'number' && input.defaultValue !== undefined && Number.isFinite(Number(input.defaultValue)) ? { defaultValue: input.defaultValue } : {}),
                ...((type === 'text' || type === 'multiline') && input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
              }
              update(index, next)
            }}><option value="text">{t('inputTypeText')}</option><option value="multiline">{t('inputTypeMultiline')}</option><option value="number">{t('inputTypeNumber')}</option><option value="boolean">{t('inputTypeBoolean')}</option><option value="select">{t('inputTypeSelect')}</option></select></label>
            <label className={c('requiredChoice')}><input type="checkbox" checked={input.required} onChange={event => { update(index, { ...input, required: event.target.checked }) }} />{t('required')}</label>
          </div>
          <input aria-label={`${t('description')} ${input.label}`} placeholder={t('inputDescriptionPlaceholder')} value={input.description ?? ''} onChange={event => {
            const value = event.target.value
            const { description: _description, ...base } = input
            update(index, value.trim() === '' ? base : { ...base, description: value })
          }} />
          {input.type === 'select' && <input aria-label={`${t('selectOptions')} ${input.label}`} value={input.options?.join(', ') ?? ''} onChange={event => {
            const options = splitList(event.target.value) ?? []
            const { defaultValue: _defaultValue, ...base } = input
            update(index, { ...base, options, ...(options.includes(input.defaultValue ?? '') ? { defaultValue: input.defaultValue } : options[0] === undefined ? {} : { defaultValue: options[0] }) })
          }} />}
          {input.type === 'boolean' ? (
            <label><span>{t('defaultValue')}</span><select aria-label={`${t('defaultValue')} ${input.label}`} value={input.defaultValue ?? 'false'} onChange={event => { update(index, { ...input, defaultValue: event.target.value }) }}><option value="false">{t('booleanFalse')}</option><option value="true">{t('booleanTrue')}</option></select></label>
          ) : input.type === 'select' ? (
            <label><span>{t('defaultValue')}</span><select aria-label={`${t('defaultValue')} ${input.label}`} value={input.defaultValue ?? ''} onChange={event => { update(index, { ...input, defaultValue: event.target.value }) }}><option value="">—</option>{input.options?.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
          ) : <input type={input.type === 'number' ? 'number' : 'text'} aria-label={`${t('defaultValue')} ${input.label}`} placeholder={t('defaultValue')} value={input.defaultValue ?? ''} onChange={event => {
            const { defaultValue: _defaultValue, ...base } = input
            update(index, event.target.value === '' ? base : { ...base, defaultValue: event.target.value })
          }} />}
        </div>
      ))}
    </div>
  )
}

function DesignSurface({ draft, selectedNode, workflowIdEditable, capabilities, canTest, t, onDraft, onSelectNode, onAddNode, onRenameNode, onDeleteNode, onTestNode }: {
  draft: GraphWorkflowDraft
  selectedNode?: string
  workflowIdEditable: boolean
  capabilities?: GraphWorkflowCapabilityCatalog
  canTest: boolean
  t: GraphWorkflowStudioProps['t']
  onDraft: (draft: GraphWorkflowDraft) => void
  onSelectNode: (id: string) => void
  onAddNode: () => void
  onRenameNode: (id: string) => void
  onDeleteNode: (id: string) => void
  onTestNode: (id: string) => void
}): ReactNode {
  const [layoutReset, setLayoutReset] = useState(0)
  const [connectionError, setConnectionError] = useState<string>()
  const structureValid = hasValidStructure(draft)
  const currentNode = draft.nodes.find(node => node.id === selectedNode)
  const updateNode = (updated: GraphWorkflowNode): void => {
    onDraft({ ...draft, nodes: draft.nodes.map(node => node.id === currentNode?.id ? updated : node) })
  }
  const connect = (sourceId: string, targetId: string): void => {
    const source = draft.nodes.find(node => node.id === sourceId)
    const target = draft.nodes.find(node => node.id === targetId)
    const createsCycle = source === undefined ? true : ancestorsOf(source, draft.nodes).includes(targetId)
    if (source === undefined || target === undefined || sourceId === targetId || target.dependsOn.includes(sourceId) || createsCycle) {
      setConnectionError(t('connectionInvalid'))
      return
    }
    setConnectionError(undefined)
    onDraft({ ...draft, nodes: draft.nodes.map(node => node.id === targetId ? { ...node, dependsOn: [...node.dependsOn, sourceId] } : node) })
  }
  const deleteEdge = (sourceId: string, targetId: string): void => {
    setConnectionError(undefined)
    onDraft({ ...draft, nodes: draft.nodes.map(node => node.id === targetId ? { ...node, dependsOn: node.dependsOn.filter(id => id !== sourceId) } : node) })
  }
  const autoLayout = (): void => {
    const layout = automaticLayoutOf(draft.nodes)
    onDraft({ ...draft, nodes: draft.nodes.map(node => ({ ...node, position: layout.positions.get(node.id) as Point })) })
    setLayoutReset(value => value + 1)
  }
  return (
    <div className={c('designLayout')}>
      <aside className={c('nodeLibrary')}>
        <div className={c('paneHead')}><span><strong>{t('nodeLibrary')}</strong><small>{t('nodeCount', { count: draft.nodes.length })}</small></span><button type="button" onClick={onAddNode}>＋</button></div>
        <div className={c('workflowFields')}>
          <TextField label={t('workflowId')} value={draft.id} disabled={!workflowIdEditable} onChange={value => { onDraft({ ...draft, id: value }) }} />
          {!workflowIdEditable && <small>{t('workflowIdLocked')}</small>}
          <TextField label={t('name')} value={draft.name} onChange={value => { onDraft({ ...draft, name: value }) }} />
          <TextField label={t('description')} value={draft.description} multiline rows={3} onChange={value => { onDraft({ ...draft, description: value }) }} />
        </div>
        <div className={c('libraryGroup')}><span>{t('generateGroup')}</span><button type="button" onClick={onAddNode}><i>✦</i><b>{t('aiTask')}</b><small>{t('aiTaskDetail')}</small><em>＋</em></button></div>
        <div className={c('inputHead')}><strong>{t('requiredInputs')}</strong><button type="button" onClick={() => {
          const item: GraphWorkflowInputDefinition = { key: `field_${String(draft.inputs.length + 1)}`, label: t('newInputLabel'), required: false }
          onDraft({ ...draft, inputs: [...draft.inputs, item] })
        }}>＋ {t('addInput')}</button></div>
        <InputEditor draft={draft} t={t} onChange={onDraft} />
        <div className={c('outline')}><strong>{t('graphOutline')}</strong><ol>{draft.nodes.map(node => <li key={node.id} className={node.id === selectedNode ? c('active') : ''}><button type="button" onClick={() => { onSelectNode(node.id) }}>{node.name}</button></li>)}</ol></div>
      </aside>
      <main className={c('canvasColumn')}>
        <div className={c('canvasToolbar')}><span><button type="button" className={c('active')}>⌁ {t('selectTool')}</button><button type="button" onClick={onAddNode}>＋ {t('addNode')}</button></span><span>{connectionError !== undefined && <i className={c('invalidGraph')} role="alert">{connectionError}</i>}<i role="status" aria-live="polite" aria-label={t('structureStatus')} className={structureValid ? '' : c('invalidGraph')}>{structureValid ? `✓ ${t('validGraph')}` : `! ${t('invalidGraph')}`}</i><button type="button" onClick={autoLayout}>{t('autoLayout')}</button></span></div>
        <DagCanvas nodes={draft.nodes} inputs={draft.inputs} outputNode={draft.outputNode} {...selectedNode === undefined ? {} : { selected: selectedNode }} onSelect={onSelectNode} onMove={(id, position) => { onDraft({ ...draft, nodes: draft.nodes.map(node => node.id === id ? { ...node, position } : node) }) }} onConnect={connect} onDeleteEdge={deleteEdge} onDeleteNode={onDeleteNode} t={t} resetKey={layoutReset} />
        <div className={c('traceBar')}><span>⌘ {t('testTrace')}</span><small>{t('canvasKeyboardHint')}</small><b>⌃</b></div>
      </main>
      {currentNode === undefined ? <aside className={c('inspector')}><div className={c('emptyState')}>{t('selectNode')}</div></aside> : (
        <NodeInspector
          node={currentNode}
          allNodes={draft.nodes}
          inputs={draft.inputs}
          isOutput={draft.outputNode === currentNode.id}
          {...capabilities === undefined ? {} : { capabilities }}
          canTest={canTest}
          t={t}
          onChange={updateNode}
          onRename={onRenameNode}
          onOutput={() => { onDraft({ ...draft, outputNode: currentNode.id }) }}
          onDelete={() => { onDeleteNode(currentNode.id) }}
          onTest={() => { onTestNode(currentNode.id) }}
        />
      )}
    </div>
  )
}

function RunEvidence({ run, t }: { run?: GraphWorkflowRunSnapshot; t: GraphWorkflowStudioProps['t'] }): ReactNode {
  const [copied, setCopied] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  useEffect(() => { setSelectedNodeId(run?.error?.nodeId ?? run?.workflow.outputNode) }, [run?.runId, run?.error?.nodeId, run?.workflow.outputNode])
  const node = run?.nodes.find(item => item.nodeId === selectedNodeId) ?? run?.nodes[0]
  const configured = run?.workflow.nodes.find(item => item.id === node?.nodeId)
  const upstream = configured === undefined || run === undefined
    ? {}
    : Object.fromEntries(configured.dependsOn.map(id => [id, run.nodes.find(item => item.nodeId === id)?.output ?? '']))
  const copy = (): void => {
    if (run?.deliverable === undefined || navigator.clipboard === undefined) return
    void navigator.clipboard.writeText(run.deliverable).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1_200)
    })
  }
  return (
    <aside className={c('evidencePane')}>
      <div className={c('paneHead')}><span><strong>{t('nodeEvidence')}</strong><small>{run === undefined ? '—' : t('runLabel', { id: run.runId })}</small></span>{run !== undefined && <span className={`${c('statusPill')} ${statusClass(run.status)}`}>{statusText(t, run.status)}</span>}</div>
      {run === undefined ? <div className={c('emptyState')}>{t('selectRun')}</div> : (
        <>
          <div className={c('summaryGrid')}><div><small>{t('statusLabel')}</small><strong>{statusText(t, run.status)}</strong></div><div><small>{t('revisionLabel')}</small><strong>{`r${String(run.workflowRevision)}`}</strong></div><div><small>{t('startedLabel')}</small><strong>{new Date(run.startedAt ?? run.createdAt).toLocaleTimeString()}</strong></div><div><small>{t('nodesLabel')}</small><strong>{`${String(run.nodes.filter(node => node.status === 'succeeded').length)}/${String(run.nodes.length)}`}</strong></div></div>
          <section className={c('evidenceList')}><h3>{t('nodesLabel')}</h3>{run.nodes.map(item => <button type="button" key={item.nodeId} className={item.nodeId === node?.nodeId ? c('active') : ''} onClick={() => { setSelectedNodeId(item.nodeId) }}><i className={statusClass(item.status)}>{item.status === 'succeeded' ? '✓' : item.status === 'failed' ? '!' : '·'}</i><span><strong>{item.name}</strong><small>{item.error?.message ?? statusText(t, item.status)}</small></span></button>)}</section>
          {node !== undefined && configured !== undefined && <section className={c('nodeEvidenceDetail')}>
            <header><span><small>{configured.id}</small><strong>{configured.name}</strong></span><i className={statusClass(node.status)}>{statusText(t, node.status)}</i></header>
            <div className={c('nodeTiming')}><span>{t('durationLabel')}</span><strong>{node.startedAt === undefined ? '—' : node.endedAt === undefined ? t('running') : `${String(Math.max(0, node.endedAt - node.startedAt))} ms`}</strong></div>
            {(configured.skill !== undefined || configured.llm !== undefined) && <div className={c('executionRoute')}>{configured.skill !== undefined && <span>{`Skill · ${configured.skill}`}</span>}{configured.llm?.provider !== undefined && <span>{configured.llm.provider}</span>}{configured.llm?.model !== undefined && <span>{configured.llm.model}</span>}</div>}
            <details><summary>{t('promptSnapshot')}</summary><pre>{configured.prompt}</pre></details>
            <details><summary>{t('inputSnapshot')}</summary><pre>{JSON.stringify({ input: run.input, upstream }, null, 2)}</pre></details>
            <div className={c('ruleEvidence')}><h3>{t('acceptanceRules')}</h3>{node.evidence === undefined || node.evidence.length === 0 ? <p>{t('noAcceptanceRules')}</p> : node.evidence.map((evidence, index) => <div key={`${evidence.kind}:${String(index)}`} className={evidence.passed ? c('passedRule') : c('failedRule')}><i>{evidence.passed ? '✓' : '!'}</i><span><strong>{t(`evidence_${evidence.kind}`)}</strong><small>{evidence.message}</small></span></div>)}</div>
            {node.error !== undefined && <p className={c('error')} role="alert">{`${node.error.code}: ${node.error.message}`}</p>}
            {node.output !== undefined && <details open><summary>{t('nodeOutput')}</summary><pre>{node.output}</pre></details>}
          </section>}
          {run.error !== undefined && <p className={c('error')} role="alert">{`${run.error.code}: ${run.error.message}`}</p>}
          {run.deliverable !== undefined && <section className={c('deliverable')}><div><h3>{t('deliverable')}</h3><button type="button" onClick={copy}>{copied ? t('copied') : t('copy')}</button></div><pre>{run.deliverable}</pre></section>}
        </>
      )}
    </aside>
  )
}

function RunInputField({ input, value, t, onChange }: {
  input: GraphWorkflowInputDefinition
  value: string
  t: GraphWorkflowStudioProps['t']
  onChange: (value: string) => void
}): ReactNode {
  const label = `${input.label}${input.required ? ' *' : ''}`
  if (input.type === 'select') {
    return <label className={c('field')}><span>{label}</span><select aria-label={label} value={value} onChange={event => { onChange(event.target.value) }}><option value="">{t('chooseOption')}</option>{input.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>{input.description !== undefined && <small>{input.description}</small>}</label>
  }
  if (input.type === 'boolean') {
    return <label className={c('field')}><span>{label}</span><select aria-label={label} value={value} onChange={event => { onChange(event.target.value) }}><option value="">{t('chooseOption')}</option><option value="true">{t('booleanTrue')}</option><option value="false">{t('booleanFalse')}</option></select>{input.description !== undefined && <small>{input.description}</small>}</label>
  }
  return <label className={c('field')}><span>{label}</span>{input.type === 'multiline' ? <textarea aria-label={label} rows={4} value={value} onChange={event => { onChange(event.target.value) }} /> : <input type={input.type === 'number' ? 'number' : 'text'} aria-label={label} value={value} onChange={event => { onChange(event.target.value) }} />}{input.description !== undefined && <small>{input.description}</small>}</label>
}

function TestSurface({ definition, runInput, runs, selectedRunId, starting, sessionReady, targetNodeId, testCases, t, onInput, onStart, onSelectRun, onCancel, onFullScope, onLoadTestCase, onSaveTestCase, onRemoveTestCase }: {
  definition?: GraphWorkflowDefinition
  runInput: Readonly<Record<string, string>>
  runs: readonly GraphWorkflowRunSnapshot[]
  selectedRunId?: string
  starting: boolean
  sessionReady: boolean
  targetNodeId?: string
  testCases: readonly GraphWorkflowTestCase[]
  t: GraphWorkflowStudioProps['t']
  onInput: (key: string, value: string) => void
  onStart: () => void
  onSelectRun: (id: string) => void
  onCancel: (id: string) => void
  onFullScope: () => void
  onLoadTestCase: (testCase: GraphWorkflowTestCase) => void
  onSaveTestCase: (name: string) => void
  onRemoveTestCase: (id: string) => void
}): ReactNode {
  const [testCaseName, setTestCaseName] = useState('')
  const relevantRuns = runs.filter(run => definition === undefined || run.workflowId === definition.id)
  const run = relevantRuns.find(candidate => candidate.runId === selectedRunId) ?? relevantRuns[0]
  const status = run === undefined ? undefined : new Map(run.nodes.map(node => [node.nodeId, node]))
  const topology = run?.workflow ?? definition
  const requiredInputs = definition?.inputs.filter(input => input.required) ?? []
  const completedRequired = requiredInputs.filter(input => (runInput[input.key] ?? input.defaultValue ?? '').trim() !== '').length
  const requiredReady = definition !== undefined && completedRequired === requiredInputs.length
  return (
    <div className={c('testLayout')}>
      <aside className={c('testInputs')}>
        <div className={c('paneHead')}><span><strong>{t('testInput')}</strong><small>{definition?.name ?? '—'}</small></span></div>
        {targetNodeId !== undefined && <div className={c('nodeTestScope')}><span>◎</span><div><strong>{t('nodeTestMode')}</strong><small>{definition?.nodes.find(node => node.id === targetNodeId)?.name ?? targetNodeId}</small></div><button type="button" onClick={onFullScope}>{t('fullWorkflow')}</button></div>}
        {definition?.inputs.map(input => <RunInputField key={input.key} input={input} value={runInput[input.key] ?? input.defaultValue ?? ''} t={t} onChange={value => { onInput(input.key, value) }} />)}
        {definition !== undefined && <div className={`${c('inputReadiness')} ${requiredReady ? c('ready') : ''}`} role="status" aria-live="polite" aria-label={t('requiredProgressAria')}><span>{requiredReady ? '✓' : `${String(completedRequired)}/${String(requiredInputs.length)}`}</span><div><strong>{requiredReady ? t('readyToRun') : t('requiredProgress', { complete: completedRequired, total: requiredInputs.length })}</strong><small>{requiredReady ? t('readyHint') : t('completeRequired')}</small></div></div>}
        <button type="button" className={c('primaryButton')} disabled={starting || definition === undefined || !sessionReady || !requiredReady} onClick={onStart}>▶ {starting ? t('executing') : targetNodeId === undefined ? t('execute') : t('executeNode')}</button>
        <small>{sessionReady ? t('unsavedHint') : t('noSession')}</small>
        {definition !== undefined && <section className={c('testCases')}><div><strong>{t('regressionCases')}</strong><small>{t('regressionCaseHint')}</small></div><label><input aria-label={t('testCaseName')} placeholder={t('testCaseName')} value={testCaseName} onChange={event => { setTestCaseName(event.target.value) }} /><button type="button" disabled={testCaseName.trim() === '' || !sessionReady} onClick={() => { onSaveTestCase(testCaseName); setTestCaseName('') }}>{t('saveCase')}</button></label>{testCases.map(testCase => <div key={testCase.id}><button type="button" onClick={() => { onLoadTestCase(testCase) }}><span>{testCase.name}</span><small>{new Date(testCase.updatedAt).toLocaleDateString()}</small></button><button type="button" aria-label={`${t('remove')} ${testCase.name}`} onClick={() => { onRemoveTestCase(testCase.id) }}>×</button></div>)}</section>}
        {relevantRuns.length > 0 && <div className={c('compactRuns')}><strong>{t('recentRuns')}</strong>{relevantRuns.slice(0, 5).map(item => <button type="button" key={item.runId} className={item.runId === run?.runId ? c('active') : ''} onClick={() => { onSelectRun(item.runId) }}><i className={statusClass(item.status)} /> <span>{item.runId}</span><small>{statusText(t, item.status)}</small></button>)}</div>}
      </aside>
      <main className={c('testCanvas')}>
        <div className={c('runSummary')} role="status" aria-live="polite"><span className={run === undefined ? '' : statusClass(run.status)} /><div><strong>{run === undefined ? t('noRuns') : statusText(t, run.status)}</strong><small>{run === undefined ? t('execute') : `${run.runId} · r${String(run.workflowRevision)}`}</small></div>{run !== undefined && (run.status === 'queued' || run.status === 'running') && <button type="button" onClick={() => { onCancel(run.runId) }}>{t('cancel')}</button>}</div>
        {topology === undefined ? <div className={c('emptyState')}>{t('empty')}</div> : <DagCanvas nodes={topology.nodes} inputs={topology.inputs} outputNode={topology.outputNode} {...status === undefined ? {} : { status }} t={t} compact />}
        {run !== undefined && <div className={c('timeline')}>{run.nodes.map(node => <div key={node.nodeId} className={statusClass(node.status)}><i /><span>{node.name}<small>{statusText(t, node.status)}</small></span></div>)}</div>}
      </main>
      <RunEvidence {...run === undefined ? {} : { run }} t={t} />
    </div>
  )
}

function RunsSurface({ runs, selectedRunId, t, onSelectRun, onCancel, onReplay }: {
  runs: readonly GraphWorkflowRunSnapshot[]
  selectedRunId?: string
  t: GraphWorkflowStudioProps['t']
  onSelectRun: (id: string) => void
  onCancel: (id: string) => void
  onReplay: (run: GraphWorkflowRunSnapshot) => void
}): ReactNode {
  const run = runs.find(candidate => candidate.runId === selectedRunId) ?? runs[0]
  const status = run === undefined ? undefined : new Map(run.nodes.map(node => [node.nodeId, node]))
  return (
    <div className={c('runsLayout')}>
      <aside className={c('runsList')}><div className={c('paneHead')}><span><strong>{t('recentRuns')}</strong><small>{t('processLocal')}</small></span><b>{String(runs.length)}</b></div>{runs.length === 0 ? <div className={c('emptyState')}>{t('noRuns')}</div> : runs.map(item => <button type="button" key={item.runId} className={item.runId === run?.runId ? c('active') : ''} onClick={() => { onSelectRun(item.runId) }}><i className={statusClass(item.status)}>{item.status === 'succeeded' ? '✓' : item.status === 'failed' ? '!' : '·'}</i><span><strong>{item.workflowName}</strong><small>{item.runId}</small></span><span><b>{statusText(t, item.status)}</b><small>{new Date(item.createdAt).toLocaleTimeString()}</small></span></button>)}</aside>
      <main className={c('runDetail')}>
        {run === undefined ? <div className={c('emptyState')}>{t('selectRun')}</div> : <><div className={c('detailHead')}><span><i className={statusClass(run.status)}>{statusText(t, run.status)}</i><strong>{run.workflowName}</strong><small>{`${run.runId} · ${t('immutableRevision', { revision: run.workflowRevision })}`}</small></span><div><button type="button" onClick={() => { onReplay(run) }}>{t('reuseRunInput')}</button>{(run.status === 'queued' || run.status === 'running') && <button type="button" onClick={() => { onCancel(run.runId) }}>{t('cancel')}</button>}</div></div><DagCanvas nodes={run.workflow.nodes} inputs={run.workflow.inputs} outputNode={run.workflow.outputNode} {...status === undefined ? {} : { status }} t={t} compact /></>}
      </main>
      <RunEvidence {...run === undefined ? {} : { run }} t={t} />
    </div>
  )
}

function versionChangeSummary(current: GraphWorkflowVersion, previous: GraphWorkflowVersion | undefined, t: GraphWorkflowStudioProps['t']): string[] {
  if (previous === undefined) return [t('versionInitial')]
  const changes: string[] = []
  if (current.name !== previous.name || current.description !== previous.description) changes.push(t('versionMetadataChanged'))
  if (JSON.stringify(current.inputs) !== JSON.stringify(previous.inputs)) changes.push(t('versionInputsChanged'))
  const previousNodes = new Map(previous.nodes.map(node => [node.id, node]))
  const currentNodes = new Map(current.nodes.map(node => [node.id, node]))
  const added = current.nodes.filter(node => !previousNodes.has(node.id)).map(node => node.name)
  const removed = previous.nodes.filter(node => !currentNodes.has(node.id)).map(node => node.name)
  const changed = current.nodes.filter(node => {
    const before = previousNodes.get(node.id)
    return before !== undefined && JSON.stringify(before) !== JSON.stringify(node)
  }).map(node => node.name)
  if (added.length > 0) changes.push(t('versionNodesAdded', { nodes: added.join('、') }))
  if (removed.length > 0) changes.push(t('versionNodesRemoved', { nodes: removed.join('、') }))
  if (changed.length > 0) changes.push(t('versionNodesChanged', { nodes: changed.join('、') }))
  if (current.outputNode !== previous.outputNode) changes.push(t('versionOutputChanged'))
  return changes.length === 0 ? [t('versionNoContentChange')] : changes
}

function VersionsSurface({ catalog, head, busy, sessionReady, t, onRefresh, onPublish, onRestore }: {
  catalog?: GraphWorkflowVersionCatalog
  head?: GraphWorkflowDefinition
  busy: boolean
  sessionReady: boolean
  t: GraphWorkflowStudioProps['t']
  onRefresh: () => void
  onPublish: (revision: number) => void
  onRestore: (revision: number) => void
}): ReactNode {
  const [selectedRevision, setSelectedRevision] = useState<number>()
  const versions = catalog?.versions ?? []
  const selected = versions.find(version => version.revision === selectedRevision) ?? versions[0]
  const previous = selected === undefined ? undefined : versions.find(version => version.revision === selected.revision - 1)
  const changes = selected === undefined ? [] : versionChangeSummary(selected, previous, t)
  return (
    <div className={c('versionsLayout')}>
      <aside className={c('versionList')}>
        <div className={c('paneHead')}><span><strong>{t('versionHistory')}</strong><small>{t('versionImmutableHint')}</small></span><button type="button" onClick={onRefresh}>↻</button></div>
        {versions.length === 0 ? <div className={c('emptyState')}>{t('loading')}</div> : versions.map(version => (
          <button type="button" key={version.revision} className={version.revision === selected?.revision ? c('active') : ''} onClick={() => { setSelectedRevision(version.revision) }}>
            <span><strong>{`r${String(version.revision)}`}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></span>
            <span>{head?.revision === version.revision && <i>{t('headVersion')}</i>}{catalog?.publishedRevision === version.revision && <i className={c('publishedTag')}>{t('publishedVersion')}</i>}</span>
          </button>
        ))}
      </aside>
      <main className={c('versionDetail')}>
        {selected === undefined ? <div className={c('emptyState')}>{t('selectVersion')}</div> : (
          <>
            <header><span><small>{t('versionCompareWith', { revision: previous?.revision ?? '—' })}</small><h2>{`${selected.name} · r${String(selected.revision)}`}</h2></span><div><button type="button" disabled={busy || !sessionReady || catalog?.publishedRevision === selected.revision} onClick={() => { onPublish(selected.revision) }}>{t('publishRevision', { revision: selected.revision })}</button><button type="button" disabled={busy || !sessionReady || head?.revision === selected.revision} onClick={() => { onRestore(selected.revision) }}>{t('restoreRevision')}</button></div></header>
            <section className={c('versionSummary')}><h3>{t('changeSummary')}</h3><ul>{changes.map(change => <li key={change}>{change}</li>)}</ul></section>
            <section className={c('versionColumns')}>
              <article><small>{t('selectedVersion')}</small><strong>{t('versionStats', { inputs: selected.inputs.length, nodes: selected.nodes.length })}</strong><p>{selected.description}</p><ol>{selected.nodes.map(node => <li key={node.id}>{node.name}<small>{node.id}</small></li>)}</ol><details><summary>{t('versionSnapshot')}</summary><pre>{JSON.stringify(selected, null, 2)}</pre></details></article>
              <article><small>{t('previousVersion')}</small>{previous === undefined ? <p>—</p> : <><strong>{t('versionStats', { inputs: previous.inputs.length, nodes: previous.nodes.length })}</strong><p>{previous.description}</p><ol>{previous.nodes.map(node => <li key={node.id}>{node.name}<small>{node.id}</small></li>)}</ol><details><summary>{t('versionSnapshot')}</summary><pre>{JSON.stringify(previous, null, 2)}</pre></details></>}</article>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

/** Workflow hub → professional editor → test/run cockpit. */
export function GraphWorkflowStudio(props: GraphWorkflowStudioProps): ReactNode {
  const { t } = props
  const initialView = props.initialView ?? 'hub'
  const [screen, setScreen] = useState<'hub' | 'workbench'>(initialView === 'hub' ? 'hub' : 'workbench')
  const [tab, setTab] = useState<'design' | 'test' | 'runs' | 'versions'>(initialView === 'test' ? 'test' : initialView === 'runs' ? 'runs' : 'design')
  const [catalog, setCatalog] = useState<GraphWorkflowCatalog>()
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState<GraphWorkflowDraft>()
  const [expectedRevision, setExpectedRevision] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [conflict, setConflict] = useState<GraphWorkflowDefinition | null>()
  const [runInput, setRunInput] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<GraphWorkflowRunSnapshot[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [versionCatalog, setVersionCatalog] = useState<GraphWorkflowVersionCatalog>()
  const [versionBusy, setVersionBusy] = useState(false)
  const [capabilityCatalog, setCapabilityCatalog] = useState<GraphWorkflowCapabilityCatalog>()
  const [testCaseCatalog, setTestCaseCatalog] = useState<GraphWorkflowTestCaseCatalog>()
  const [targetNodeId, setTargetNodeId] = useState<string>()
  const [query, setQuery] = useState('')
  const [undoStack, setUndoStack] = useState<GraphWorkflowDraft[]>([])
  const [redoStack, setRedoStack] = useState<GraphWorkflowDraft[]>([])
  const launchController = useRef<AbortController>()
  const pollInFlight = useRef(false)
  const saveInFlight = useRef(false)
  const startInFlight = useRef(false)
  const removeInFlight = useRef(false)
  const versionInFlight = useRef(false)
  const testCaseInFlight = useRef(false)
  const initialized = useRef(false)
  const cleanDraft = useRef<string>()

  const selectDefinition = useCallback((definition: GraphWorkflowDefinition, view: 'design' | 'test' | 'runs' = 'design'): void => {
    setSelectedId(definition.id)
    const nextDraft = editable(definition)
    setDraft(nextDraft)
    cleanDraft.current = JSON.stringify(nextDraft)
    setUndoStack([])
    setRedoStack([])
    setExpectedRevision(definition.revision)
    setSelectedNode(definition.nodes[0]?.id)
    setDirty(false)
    setConflict(undefined)
    setVersionCatalog(undefined)
    setTestCaseCatalog(undefined)
    setTargetNodeId(undefined)
    setMessage(undefined)
    setRunInput(Object.fromEntries(definition.inputs.map(input => [input.key, input.defaultValue ?? ''])))
    setTab(view)
    setScreen('workbench')
  }, [])

  const createDraft = useCallback((source: GraphWorkflowCatalog | undefined): void => {
    const created = newWorkflow(source, t)
    setSelectedId(created.id)
    setDraft(created)
    cleanDraft.current = undefined
    setUndoStack([])
    setRedoStack([])
    setExpectedRevision(0)
    setSelectedNode(created.nodes[0]?.id)
    setRunInput({ brief: '' })
    setDirty(true)
    setConflict(undefined)
    setVersionCatalog(undefined)
    setTestCaseCatalog(undefined)
    setTargetNodeId(undefined)
    setMessage(undefined)
    setTab('design')
    setScreen('workbench')
  }, [t])

  const loadCatalog = useCallback(async (): Promise<void> => {
    const result = await props.catalog({ workspaceId: props.workspaceId })
    if (!result.ok) { setMessage(errorText(result)); return }
    setCatalog(result.value)
    props.onCatalogChange?.(result.value)
    if (initialized.current) return
    initialized.current = true
    if (initialView === 'new') { createDraft(result.value); return }
    if (props.initialWorkflowId !== undefined) {
      const selected = result.value.workflows.find(workflow => workflow.id === props.initialWorkflowId)
      if (selected !== undefined) selectDefinition(selected, initialView === 'test' ? 'test' : initialView === 'runs' ? 'runs' : 'design')
    }
  }, [createDraft, initialView, props.catalog, props.initialWorkflowId, props.onCatalogChange, props.workspaceId, selectDefinition])

  useEffect(() => { void loadCatalog() }, [loadCatalog])
  useEffect(() => () => { launchController.current?.abort(new Error('Graph Workflow UI unmounted')) }, [])
  useEffect(() => { props.onDirtyChange?.(dirty) }, [dirty, props.onDirtyChange])
  useEffect(() => {
    if (!props.sessionReady || typeof props.capabilities !== 'function') { setCapabilityCatalog(undefined); return }
    let active = true
    void props.capabilities().then(result => { if (active && result.ok) setCapabilityCatalog(result.value) })
    return () => { active = false }
  }, [props.capabilities, props.sessionReady])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty])

  const pollRuns = useCallback(async (): Promise<void> => {
    if (!props.sessionReady || pollInFlight.current) return
    pollInFlight.current = true
    try {
      const result = await props.runs()
      if (result.ok) {
        setRuns([...result.value.runs])
        setSelectedRunId(current => current ?? result.value.runs[0]?.runId)
      }
    } finally { pollInFlight.current = false }
  }, [props.runs, props.sessionReady])

  useEffect(() => {
    if (!props.sessionReady) { setRuns([]); return }
    void pollRuns()
    const timer = window.setInterval(() => { void pollRuns() }, 900)
    return () => { window.clearInterval(timer) }
  }, [pollRuns, props.sessionReady])

  const mutateDraft = (next: GraphWorkflowDraft): void => {
    if (draft !== undefined && JSON.stringify(draft) !== JSON.stringify(next)) {
      setUndoStack(current => [...current.slice(-99), draft])
      setRedoStack([])
    }
    setDraft(next)
    setDirty(cleanDraft.current === undefined || JSON.stringify(next) !== cleanDraft.current)
    setConflict(undefined)
    setMessage(undefined)
  }
  const undo = (): void => {
    const previous = undoStack.at(-1)
    if (previous === undefined || draft === undefined) return
    setUndoStack(current => current.slice(0, -1))
    setRedoStack(current => [...current.slice(-99), draft])
    setDraft(previous)
    setDirty(cleanDraft.current === undefined || JSON.stringify(previous) !== cleanDraft.current)
    setSelectedNode(current => previous.nodes.some(node => node.id === current) ? current : previous.nodes[0]?.id)
    setConflict(undefined)
  }
  const redo = (): void => {
    const next = redoStack.at(-1)
    if (next === undefined || draft === undefined) return
    setRedoStack(current => current.slice(0, -1))
    setUndoStack(current => [...current.slice(-99), draft])
    setDraft(next)
    setDirty(cleanDraft.current === undefined || JSON.stringify(next) !== cleanDraft.current)
    setSelectedNode(current => next.nodes.some(node => node.id === current) ? current : next.nodes[0]?.id)
    setConflict(undefined)
  }
  const activeDefinition = catalog?.workflows.find(workflow => workflow.id === selectedId)

  const replaceDefinition = useCallback((definition: GraphWorkflowDefinition): void => {
    setCatalog(current => {
      const next: GraphWorkflowCatalog = {
        workspaceId: props.workspaceId,
        revision: (current?.revision ?? 0) + 1,
        workflows: [...(current?.workflows.filter(workflow => workflow.id !== definition.id) ?? []), definition]
          .sort((left, right) => left.id.localeCompare(right.id)),
      }
      props.onCatalogChange?.(next)
      return next
    })
  }, [props.onCatalogChange, props.workspaceId])

  const loadVersions = useCallback(async (): Promise<void> => {
    if (selectedId === undefined || expectedRevision === 0 || typeof props.versions !== 'function') return
    const result = await props.versions({ workspaceId: props.workspaceId, workflowId: selectedId })
    if (!result.ok) { setMessage(errorText(result)); return }
    setVersionCatalog(result.value)
  }, [expectedRevision, props.versions, props.workspaceId, selectedId])

  const loadTestCases = useCallback(async (): Promise<void> => {
    if (selectedId === undefined || expectedRevision === 0 || !props.sessionReady || typeof props.testCases !== 'function') {
      setTestCaseCatalog(undefined)
      return
    }
    const result = await props.testCases({ workflowId: selectedId })
    if (result.ok) setTestCaseCatalog(result.value)
  }, [expectedRevision, props.sessionReady, props.testCases, selectedId])

  useEffect(() => { void loadTestCases() }, [loadTestCases])

  const save = async (): Promise<void> => {
    if (draft === undefined || saveInFlight.current) return
    if (!props.sessionReady) { setMessage(t('noSession')); return }
    saveInFlight.current = true
    setSaving(true); setMessage(undefined); setConflict(undefined)
    const result = await props.save({ workflow: draft, expectedRevision })
    saveInFlight.current = false
    setSaving(false)
    if (!result.ok) {
      if (result.code === 'GRAPH_WORKFLOW_CONFLICT') {
        const latest = await props.catalog({ workspaceId: props.workspaceId })
        if (latest.ok) {
          setCatalog(latest.value)
          props.onCatalogChange?.(latest.value)
          setConflict(latest.value.workflows.find(workflow => workflow.id === draft.id) ?? null)
        }
      }
      setMessage(errorText(result))
      return
    }
    replaceDefinition(result.value)
    const savedDraft = editable(result.value)
    cleanDraft.current = JSON.stringify(savedDraft)
    setUndoStack([]); setRedoStack([])
    setExpectedRevision(result.value.revision); setSelectedId(result.value.id); setDraft(savedDraft); setDirty(false); setConflict(undefined)
    setMessage(t('saved', { revision: result.value.revision }))
  }

  const publishRevision = async (revision: number): Promise<void> => {
    if (activeDefinition === undefined || versionInFlight.current) return
    versionInFlight.current = true
    setVersionBusy(true); setMessage(undefined)
    const result = await props.publish({
      workflowId: activeDefinition.id,
      revision,
      expectedRevision: activeDefinition.revision,
      ...(activeDefinition.publishedRevision === undefined ? {} : { expectedPublishedRevision: activeDefinition.publishedRevision }),
    })
    versionInFlight.current = false
    setVersionBusy(false)
    if (!result.ok) { setMessage(errorText(result)); return }
    replaceDefinition(result.value)
    setMessage(t('publishedMessage', { revision }))
    await loadVersions()
  }

  const restoreRevision = async (revision: number): Promise<void> => {
    if (activeDefinition === undefined || versionInFlight.current || !window.confirm(t('confirmRestore', { revision }))) return
    versionInFlight.current = true
    setVersionBusy(true); setMessage(undefined)
    const result = await props.restore({ workflowId: activeDefinition.id, revision, expectedRevision: activeDefinition.revision })
    versionInFlight.current = false
    setVersionBusy(false)
    if (!result.ok) { setMessage(errorText(result)); return }
    replaceDefinition(result.value)
    selectDefinition(result.value, 'design')
    setMessage(t('restoredMessage', { revision: result.value.revision }))
    await loadVersions()
  }

  const loadRemoteConflict = (): void => {
    if (conflict === undefined) return
    if (conflict === null) {
      setConflict(undefined)
      setMessage(t('workflowRemovedRemote'))
      return
    }
    if (!window.confirm(t('confirmLoadRemote'))) return
    selectDefinition(conflict, 'design')
    setMessage(t('remoteLoaded', { revision: conflict.revision }))
  }

  const saveConflictAsCopy = (): void => {
    if (draft === undefined) return
    const id = uniqueWorkflowId(catalog, draft.id)
    setDraft({ ...draft, id, name: t('copyName', { name: draft.name }) })
    cleanDraft.current = undefined
    setUndoStack([]); setRedoStack([])
    setSelectedId(id)
    setExpectedRevision(0)
    setDirty(true)
    setConflict(undefined)
    setMessage(t('copyReady'))
  }

  const remove = async (): Promise<void> => {
    if (draft === undefined || expectedRevision === 0 || removeInFlight.current || !window.confirm(t('confirmDelete'))) return
    if (!props.sessionReady) { setMessage(t('noSession')); return }
    removeInFlight.current = true
    setRemoving(true)
    const result = await props.remove({ workflowId: draft.id, expectedRevision })
    removeInFlight.current = false
    setRemoving(false)
    if (!result.ok) { setMessage(errorText(result)); return }
    const nextCatalog: GraphWorkflowCatalog = {
      workspaceId: props.workspaceId,
      revision: (catalog?.revision ?? 0) + 1,
      workflows: catalog?.workflows.filter(workflow => workflow.id !== draft.id) ?? [],
    }
    setCatalog(nextCatalog); props.onCatalogChange?.(nextCatalog); setScreen('hub'); setSelectedId(undefined); setDraft(undefined); setDirty(false)
  }

  const addNode = (): void => {
    if (draft === undefined) return
    let sequence = draft.nodes.length + 1
    while (draft.nodes.some(node => node.id === `node-${String(sequence)}`)) sequence += 1
    const node: GraphWorkflowNode = { id: `node-${String(sequence)}`, name: t('newNodeName', { sequence }), dependsOn: draft.nodes.length === 0 ? [] : [draft.nodes.at(-1)?.id as string], prompt: t('newNodePrompt') }
    mutateDraft({ ...draft, nodes: [...draft.nodes, node] }); setSelectedNode(node.id)
  }

  const renameNode = (nextId: string): void => {
    if (draft === undefined || selectedNode === undefined) return
    const previous = selectedNode
    mutateDraft({
      ...draft,
      outputNode: draft.outputNode === previous ? nextId : draft.outputNode,
      nodes: draft.nodes.map(node => node.id === previous ? { ...node, id: nextId } : {
        ...node,
        dependsOn: node.dependsOn.map(id => id === previous ? nextId : id),
        prompt: replaceTemplateReference(node.prompt, 'nodes', previous, nextId),
      }),
    })
    setSelectedNode(nextId)
  }

  const deleteNode = (id: string): void => {
    if (draft === undefined || draft.nodes.length === 1) return
    const nodes = draft.nodes.filter(node => node.id !== id).map(node => ({ ...node, dependsOn: node.dependsOn.filter(dependency => dependency !== id) }))
    mutateDraft({ ...draft, nodes, outputNode: draft.outputNode === id ? nodes[0]?.id ?? '' : draft.outputNode })
    setSelectedNode(nodes[0]?.id)
  }

  const start = async (): Promise<void> => {
    if (startInFlight.current) return
    if (activeDefinition === undefined) { setMessage(t('unsavedHint')); return }
    if (!props.sessionReady) { setMessage(t('noSession')); return }
    startInFlight.current = true
    const controller = new AbortController(); launchController.current = controller; setStarting(true); setMessage(undefined)
    const result = await props.start({
      workflowId: activeDefinition.id,
      workflowRevision: activeDefinition.revision,
      input: runInput,
      ...(targetNodeId === undefined ? {} : { targetNodeId }),
    }, controller.signal)
    if (launchController.current === controller) launchController.current = undefined
    startInFlight.current = false
    setStarting(false)
    if (!result.ok) { setMessage(result.kind === 'no-session' ? t('noSession') : errorText(result)); return }
    setSelectedRunId(result.value.runId); await pollRuns()
  }

  const cancel = async (runId: string): Promise<void> => { await props.cancel(runId); await pollRuns() }

  const saveTestCase = async (name: string): Promise<void> => {
    if (activeDefinition === undefined || testCaseInFlight.current) return
    testCaseInFlight.current = true
    const fallback = `case-${String((testCaseCatalog?.testCases.length ?? 0) + 1)}`
    const result = await props.saveTestCase({
      workflowId: activeDefinition.id,
      testCase: { id: slugId(name, fallback), name, input: runInput },
    })
    testCaseInFlight.current = false
    if (!result.ok) { setMessage(errorText(result)); return }
    setMessage(t('caseSaved'))
    await loadTestCases()
  }

  const removeTestCase = async (testCaseId: string): Promise<void> => {
    if (activeDefinition === undefined) return
    const result = await props.removeTestCase({ workflowId: activeDefinition.id, testCaseId })
    if (!result.ok) { setMessage(errorText(result)); return }
    await loadTestCases()
  }

  if (screen === 'hub') {
    return <WorkflowHub catalog={catalog} runs={runs} query={query} t={t} onQuery={setQuery} onNew={() => { createDraft(catalog) }} onOpen={selectDefinition} />
  }

  return (
    <div className={c('workbench')} onKeyDown={event => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable="true"]') || (!event.metaKey && !event.ctrlKey)) return
      if (event.key.toLocaleLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); redo() }
      else if (event.key.toLocaleLowerCase() === 'z') { event.preventDefault(); undo() }
      else if (event.key.toLocaleLowerCase() === 'y') { event.preventDefault(); redo() }
    }}>
      <header className={c('workbenchHeader')}>
        <div className={c('titleCluster')}>
          <button type="button" className={c('backButton')} aria-label={t('backToHub')} onClick={() => {
            if (!dirty || window.confirm(t('confirmDiscard'))) setScreen('hub')
          }}>←</button>
          <div><div className={c('breadcrumbs')}>{props.workspaceTitle} / {t('hubTitle')} /</div><div className={c('titleLine')}><h1>{draft?.name ?? t('newWorkflow')}</h1><span className={c('revisionBadge')}>{expectedRevision === 0 ? t('newBadge') : `r${String(expectedRevision)}`}</span>{expectedRevision > 0 && <span className={c('publicationState')}>{activeDefinition?.publishedRevision === undefined ? t('draftStatus') : activeDefinition.publishedRevision === expectedRevision ? t('publishedVersion') : t('productionRevision', { revision: activeDefinition.publishedRevision })}</span>}<span className={dirty ? c('dirtyState') : c('cleanState')}>{dirty ? t('unsaved') : t('saved', { revision: expectedRevision })}</span></div></div>
        </div>
        <div className={c('headerActions')}>
          <button type="button" aria-label={t('undo')} title={t('undoShortcut')} disabled={undoStack.length === 0} onClick={undo}>↶</button>
          <button type="button" aria-label={t('redo')} title={t('redoShortcut')} disabled={redoStack.length === 0} onClick={redo}>↷</button>
          <button type="button" onClick={() => { setMessage(draft !== undefined && hasValidStructure(draft) ? t('validGraph') : t('invalidGraph')) }}>✓ {t('validate')}</button>
          <button type="button" className={c('dangerButton')} disabled={expectedRevision === 0 || removing} onClick={() => { void remove() }}>{t('remove')}</button>
          <button type="button" className={dirty ? c('primaryButton') : ''} disabled={saving || !dirty || !props.sessionReady} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</button>
          <button type="button" disabled={dirty || expectedRevision === 0 || !props.sessionReady || versionBusy || activeDefinition?.publishedRevision === expectedRevision} onClick={() => { void publishRevision(expectedRevision) }}>{activeDefinition?.publishedRevision === expectedRevision ? t('published') : t('publish')}</button>
          <button type="button" className={dirty ? '' : c('primaryButton')} disabled={activeDefinition === undefined || !props.sessionReady || dirty} onClick={() => { setTargetNodeId(undefined); setTab('test') }}>▶ {t('testRun')}</button>
        </div>
        <nav className={c('viewTabs')} role="tablist" aria-label={t('workflowViews')}>
          {([
            ['design', t('design')], ['test', t('test')], ['runs', t('run')], ['versions', t('versions')],
          ] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? c('active') : ''} onClick={() => { if (key === 'test') setTargetNodeId(undefined); setTab(key); if (key === 'versions') void loadVersions() }}>{label}{key === 'runs' && runs.length > 0 ? <i>{runs.length}</i> : null}</button>)}
        </nav>
      </header>
      {message !== undefined && <div className={c('notice')} role="status">{message}</div>}
      {conflict !== undefined && (
        <div className={c('conflictNotice')} role="alert">
          <span><strong>{t('conflictTitle')}</strong><small>{conflict === null ? t('conflictDeleted') : t('conflictDescription', { revision: conflict.revision })}</small></span>
          <div>
            <button type="button" disabled={conflict === null} onClick={loadRemoteConflict}>{t('loadRemote')}</button>
            <button type="button" className={c('primaryButton')} onClick={saveConflictAsCopy}>{t('saveAsCopy')}</button>
          </div>
        </div>
      )}
      {!props.sessionReady && <div className={c('sessionNotice')} role="status">{t('noSession')}</div>}
      <div className={c('workbenchBody')}>
        {tab === 'design'
          ? draft === undefined ? <div className={c('emptyState')}>{t('loading')}</div> : <DesignSurface draft={draft} {...selectedNode === undefined ? {} : { selectedNode }} workflowIdEditable={expectedRevision === 0} {...capabilityCatalog === undefined ? {} : { capabilities: capabilityCatalog }} canTest={!dirty && activeDefinition !== undefined && props.sessionReady} t={t} onDraft={mutateDraft} onSelectNode={setSelectedNode} onAddNode={addNode} onRenameNode={renameNode} onDeleteNode={deleteNode} onTestNode={nodeId => { setTargetNodeId(nodeId); setTab('test') }} />
          : tab === 'test'
            ? <TestSurface {...activeDefinition === undefined ? {} : { definition: activeDefinition }} runInput={runInput} runs={runs} {...selectedRunId === undefined ? {} : { selectedRunId }} {...targetNodeId === undefined ? {} : { targetNodeId }} testCases={testCaseCatalog?.testCases ?? []} starting={starting} sessionReady={props.sessionReady} t={t} onInput={(key, value) => { setRunInput(current => ({ ...current, [key]: value })) }} onStart={() => { void start() }} onSelectRun={setSelectedRunId} onCancel={runId => { void cancel(runId) }} onFullScope={() => { setTargetNodeId(undefined) }} onLoadTestCase={testCase => { setRunInput({ ...testCase.input }); setMessage(t('caseLoaded', { name: testCase.name })) }} onSaveTestCase={name => { void saveTestCase(name) }} onRemoveTestCase={id => { void removeTestCase(id) }} />
            : tab === 'runs'
              ? <RunsSurface runs={runs} {...selectedRunId === undefined ? {} : { selectedRunId }} t={t} onSelectRun={setSelectedRunId} onCancel={runId => { void cancel(runId) }} onReplay={run => {
                  const definition = catalog?.workflows.find(workflow => workflow.id === run.workflowId)
                  if (definition === undefined) { setMessage(t('replayWorkflowMissing')); return }
                  selectDefinition(definition, 'test')
                  setRunInput({ ...run.input })
                  setTargetNodeId(run.targetNodeId)
                  setMessage(t('runInputLoaded'))
                }} />
              : <VersionsSurface {...versionCatalog === undefined ? {} : { catalog: versionCatalog }} {...activeDefinition === undefined ? {} : { head: activeDefinition }} busy={versionBusy} sessionReady={props.sessionReady} t={t} onRefresh={() => { void loadVersions() }} onPublish={revision => { void publishRevision(revision) }} onRestore={revision => { void restoreRevision(revision) }} />}
      </div>
    </div>
  )
}
