import { describe, expect, it } from 'vitest'
import type { GraphWorkflowDefinition, GraphWorkflowDraft } from '../src/domain.ts'
import { normalizeRunInput, normalizeWorkflowDraft, topologicalLayers } from '../src/domain.ts'

const limits = { maxNodesPerWorkflow: 16, maxPromptChars: 2_000, maxInputChars: 1_000 }

function draft(overrides: Partial<GraphWorkflowDraft> = {}): GraphWorkflowDraft {
  return {
    id: 'test-flow',
    name: 'Test flow',
    description: 'A reusable test flow.',
    inputs: [{ key: 'brief', label: 'Brief', required: true }],
    nodes: [
      { id: 'research', name: 'Research', dependsOn: [], prompt: 'Research {{input.brief}}' },
      { id: 'draft', name: 'Draft', dependsOn: ['research'], prompt: 'Write from {{nodes.research}}' },
    ],
    outputNode: 'draft',
    ...overrides,
  }
}

function definition(value = draft()): GraphWorkflowDefinition {
  return { ...normalizeWorkflowDraft(value, limits), workspaceId: 'workspace-a', revision: 1, createdAt: 1, updatedAt: 1 }
}

describe('Graph Workflow domain', () => {
  it('normalizes and deeply freezes a valid DAG with deterministic layers', () => {
    const normalized = normalizeWorkflowDraft(draft(), limits)
    expect(topologicalLayers(normalized.nodes)).toEqual([['research'], ['draft']])
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.nodes)).toBe(true)
    expect(() => { (normalized.nodes as GraphWorkflowDraft['nodes'] & GraphWorkflowDraft['nodes'][number][])[0]!.name = 'mutated' })
      .toThrow()
  })

  it.each([
    {
      label: 'a cycle',
      value: draft({ nodes: [
        { id: 'one', name: 'One', dependsOn: ['two'], prompt: 'one' },
        { id: 'two', name: 'Two', dependsOn: ['one'], prompt: 'two' },
      ], outputNode: 'two' }),
      error: /cycle/,
    },
    {
      label: 'a dangling dependency',
      value: draft({ nodes: [{ id: 'one', name: 'One', dependsOn: ['missing'], prompt: 'one' }], outputNode: 'one' }),
      error: /depends on unknown node/,
    },
    {
      label: 'a non-ancestor output reference',
      value: draft({ nodes: [
        { id: 'one', name: 'One', dependsOn: [], prompt: 'one' },
        { id: 'two', name: 'Two', dependsOn: [], prompt: '{{nodes.one}}' },
      ], outputNode: 'two' }),
      error: /without a dependency path/,
    },
    {
      label: 'an unknown input reference',
      value: draft({ nodes: [{ id: 'one', name: 'One', dependsOn: [], prompt: '{{input.unknown}}' }], outputNode: 'one' }),
      error: /unknown input/,
    },
  ])('rejects $label', ({ value, error }) => {
    expect(() => normalizeWorkflowDraft(value, limits)).toThrow(error)
  })

  it('applies defaults, rejects unknown keys, and rejects non-string values without crashing', () => {
    const workflow = definition(draft({
      inputs: [
        { key: 'brief', label: 'Brief', required: true },
        { key: 'tone', label: 'Tone', required: false, defaultValue: 'warm' },
        { key: 'notes', label: 'Notes', required: false },
      ],
    }))
    expect(normalizeRunInput(workflow, { brief: 'hello' }, 100)).toEqual({ brief: 'hello', tone: 'warm', notes: '' })
    expect(() => normalizeRunInput(workflow, { brief: 'ok', extra: 'no' }, 100)).toThrow(/unknown workflow input/)
    expect(() => normalizeRunInput(workflow, { brief: 42 }, 100)).toThrow(/must be a string/)
    expect(() => normalizeRunInput(workflow, { brief: '   ' }, 100)).toThrow(/missing required/)
  })

  it('rejects malformed nested contracts and oversized persisted defaults on direct calls', () => {
    expect(() => normalizeWorkflowDraft(draft({
      nodes: [{ id: 'one', name: 'One', dependsOn: [], prompt: 'one', llm: 42 as never }],
      outputNode: 'one',
    }), limits)).toThrow(/llm must be an object/)
    expect(() => normalizeWorkflowDraft(draft({
      inputs: [{ key: 'brief', label: 'Brief', required: false, defaultValue: 'x'.repeat(1_001) }],
    }), limits)).toThrow(/defaultValue exceeds/)
  })

  it('normalizes typed inputs and persisted canvas positions', () => {
    const normalized = normalizeWorkflowDraft(draft({
      inputs: [
        { key: 'count', label: 'Count', required: true, type: 'number', defaultValue: '2' },
        { key: 'approved', label: 'Approved', required: true, type: 'boolean', defaultValue: 'false' },
        { key: 'tone', label: 'Tone', required: true, type: 'select', options: ['warm', 'direct'], defaultValue: 'warm' },
      ],
      nodes: [{ id: 'one', name: 'One', dependsOn: [], prompt: '{{input.count}}', position: { x: 12.4, y: 98.7 } }],
      outputNode: 'one',
    }), limits)
    expect(normalized.nodes[0]?.position).toEqual({ x: 12, y: 99 })
    const saved = definition(normalized)
    expect(normalizeRunInput(saved, { count: '3', approved: 'false', tone: 'direct' }, 100))
      .toEqual({ count: '3', approved: 'false', tone: 'direct' })
    expect(() => normalizeRunInput(saved, { count: 'many', approved: 'false', tone: 'direct' }, 100)).toThrow(/numeric/)
    expect(() => normalizeRunInput(saved, { count: '3', approved: 'maybe', tone: 'direct' }, 100)).toThrow(/true.*false/)
    expect(() => normalizeRunInput(saved, { count: '3', approved: 'true', tone: 'unknown' }, 100)).toThrow(/one of its options/)
  })
})
