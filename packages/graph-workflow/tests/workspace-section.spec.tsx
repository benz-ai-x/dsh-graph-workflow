// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GraphWorkflowDefinition } from '../src/domain.ts'
import { XIAOHONGSHU_WORKFLOW } from '../src/domain.ts'
import type { WorkspaceGraphWorkflowSectionProps } from '../src/client/WorkspaceGraphWorkflowSection.tsx'
import { WorkspaceGraphWorkflowSection } from '../src/client/WorkspaceGraphWorkflowSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const definition: GraphWorkflowDefinition = {
  ...XIAOHONGSHU_WORKFLOW,
  workspaceId: 'workspace-content-ops',
  revision: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

describe('WorkspaceGraphWorkflowSection', () => {
  it('renders beside Sessions for its owner Workspace and opens the product workbench, never global settings', async () => {
    const current = 'other-session' as SessionId
    const activateWorkspace = vi.fn()
    const catalog = vi.fn().mockResolvedValue({
      ok: true,
      value: { workspaceId: 'workspace-content-ops', revision: 1, workflows: [definition] },
    })
    const props = {
      workspaceId: 'workspace-content-ops',
      workspacePath: '/workspaces/content-ops',
      workspaceTitle: '内容运营',
      sessionIds: ['workspace-session' as SessionId],
      activateWorkspace,
      useSessions: <T,>(selector: (state: { current: SessionId }) => T): T => selector({ current }),
      t: (key: keyof typeof zh, variables?: Record<string, unknown>) => {
        const value = zh[key]
        return variables === undefined ? value : Object.entries(variables).reduce(
          (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value as string,
        )
      },
      catalog,
      save: vi.fn(),
      remove: vi.fn(),
      start: vi.fn(),
      runs: vi.fn(),
      cancel: vi.fn(),
    } as unknown as WorkspaceGraphWorkflowSectionProps

    render(<WorkspaceGraphWorkflowSection {...props} />)
    expect(await screen.findByText('小红书运营文案')).toBeTruthy()
    expect(catalog).toHaveBeenCalledWith({ workspaceId: 'workspace-content-ops' })

    fireEvent.click(screen.getByRole('button', { name: /小红书运营文案/ }))
    expect(activateWorkspace).toHaveBeenCalledOnce()
    const dialog = screen.getByRole('dialog', { name: '工作流中心' })
    expect(within(dialog).getByText('内容运营')).toBeTruthy()
    expect(within(dialog).getByText('已打开工作流；保存或运行前需要进入这个工作区的会话。')).toBeTruthy()
    await waitFor(() => { expect(catalog).toHaveBeenCalledTimes(2) })

    const close = screen.getByRole('button', { name: '关闭工作流中心' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
