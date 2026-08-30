import { Context } from '@deepseek-ai/cordis'
import { apply as applyRemote, inject as remoteInject } from '@deepseek-ai/dsh-api-gateway/src/client/index.ts'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import graphWorkflowRemote from '../lib/typert.remote-client.js'

describe('Graph Workflow generated Remote contribution', () => {
  it('mounts through the real Client Remote namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry).await()
    ctx.provide('connection', {
      rpc: {
        call: vi.fn(),
        open: vi.fn(() => { throw new Error('fixture stream must not open') }),
      },
      registerGenerationSource: vi.fn(() => () => {}),
      start: vi.fn(() => ({ stop: () => {} })),
    })
    await ctx.plugin({ inject: [...remoteInject], apply: applyRemote }).await()

    let dispose: (() => Promise<void>) | undefined
    try {
      dispose = await ctx.remote.$mount(graphWorkflowRemote)
      expect(ctx.get('remote.graphWorkflows')).toBeDefined()
    } finally {
      await dispose?.()
      await ctx.fiber.dispose()
    }
  })
})
