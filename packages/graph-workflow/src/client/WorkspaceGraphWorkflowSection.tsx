import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { IconBranchOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { GraphWorkflowCatalog } from 'dsh-graph-workflow/types'
import {
  GraphWorkflowStudio,
  type GraphWorkflowInitialView,
  type GraphWorkflowStudioInjected,
} from './GraphWorkflowStudio.tsx'
import css from './WorkspaceGraphWorkflowSection.module.css'

export type WorkspaceGraphWorkflowSectionProps =
  PropsRuntime<'sidebar.workspace.section'>
  & PropsLocale<'graphWorkflow'>
  & InjectFace<GraphWorkflowStudioInjected>

interface OpenSurface {
  readonly view: GraphWorkflowInitialView
  readonly workflowId?: string
  readonly nonce: number
}

/** Workspace-tree sibling section and full product workbench launcher. */
export function WorkspaceGraphWorkflowSection({
  workspaceId,
  workspaceTitle,
  sessionIds,
  activateWorkspace,
  useSessions,
  t,
  catalog: readCatalog,
  versions,
  save,
  publish,
  restore,
  remove,
  capabilities,
  testCases,
  saveTestCase,
  removeTestCase,
  start,
  runs,
  cancel,
}: WorkspaceGraphWorkflowSectionProps) {
  const ownerId = String(workspaceId)
  const [catalog, setCatalog] = useState<GraphWorkflowCatalog>()
  const [catalogError, setCatalogError] = useState<string>()
  const [opened, setOpened] = useState<OpenSurface>()
  const [studioDirty, setStudioDirty] = useState(false)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const currentSessionId = useSessions(state => state.current)
  const sessionReady = currentSessionId !== undefined && sessionIds.includes(currentSessionId)

  const load = useCallback(async (): Promise<void> => {
    const result = await readCatalog({ workspaceId: ownerId })
    if (!result.ok) { setCatalogError(result.message); return }
    setCatalog(result.value)
    setCatalogError(undefined)
  }, [ownerId, readCatalog])

  useEffect(() => { void load() }, [load])

  const close = useCallback(() => {
    if (studioDirty && !window.confirm(t('confirmDiscard'))) return
    setOpened(undefined)
    setStudioDirty(false)
    window.setTimeout(() => { returnFocus.current?.focus() }, 0)
  }, [studioDirty, t])
  const open = (view: GraphWorkflowInitialView, workflowId?: string): void => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!sessionReady) activateWorkspace()
    setStudioDirty(false)
    setOpened({ view, ...(workflowId === undefined ? {} : { workflowId }), nonce: Date.now() })
  }

  useEffect(() => {
    if (opened === undefined) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { close(); return }
      if (event.key !== 'Tab' || panel.current === null) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close, opened])

  return (
    <section className={css.section} aria-label={t('sectionAria')}>
      <div className={css.heading}>
        <button type="button" className={css.headingMain} onClick={() => { open('hub') }}>
          <IconBranchOutline16 size={13} />
          <span>{t('nav')}</span>
          <small>{String(catalog?.workflows.length ?? 0)}</small>
        </button>
        <button type="button" className={css.add} aria-label={t('sectionNewAria', { workspace: workspaceTitle })} onClick={() => { open('new') }}>＋</button>
      </div>
      {catalogError !== undefined ? (
        <button type="button" className={css.errorRow} onClick={() => { void load() }}>{t('retry')}</button>
      ) : (
        <div className={css.rows}>
          {catalog?.workflows.slice(0, 3).map(workflow => (
            <button type="button" key={workflow.id} className={css.row} onClick={() => { open('design', workflow.id) }}>
              <span className={css.icon}><IconBranchOutline16 size={12} /></span>
              <span className={css.rowCopy}><strong>{workflow.name}</strong><small>{`${t('nodeCount', { count: workflow.nodes.length })} · r${String(workflow.revision)}`}</small></span>
            </button>
          ))}
          {(catalog?.workflows.length ?? 0) > 3 && <button type="button" className={css.openAll} onClick={() => { open('hub') }}>{t('sectionOpenAll')}<small>{String(catalog?.workflows.length ?? 0)}</small></button>}
        </div>
      )}
      {opened !== undefined && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={close} />
          <section ref={panel} className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className={css.panelHeader}>
              <div><span>{workspaceTitle}</span><h2 id={titleId}>{t('workspaceCenter')}</h2></div>
              <button ref={closeButton} type="button" className={css.close} aria-label={t('closeWorkspace')} onClick={close}><IconCloseOutline16 size={16} /></button>
            </header>
            <div className={css.content}>
              <GraphWorkflowStudio
                key={`${ownerId}:${String(opened.nonce)}`}
                workspaceId={ownerId}
                workspaceTitle={workspaceTitle}
                sessionReady={sessionReady}
                initialView={opened.view}
                {...opened.workflowId === undefined ? {} : { initialWorkflowId: opened.workflowId }}
                t={t}
                catalog={readCatalog}
                versions={versions}
                save={save}
                publish={publish}
                restore={restore}
                remove={remove}
                capabilities={capabilities}
                testCases={testCases}
                saveTestCase={saveTestCase}
                removeTestCase={removeTestCase}
                start={start}
                runs={runs}
                cancel={cancel}
                onCatalogChange={setCatalog}
                onDirtyChange={setStudioDirty}
              />
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
