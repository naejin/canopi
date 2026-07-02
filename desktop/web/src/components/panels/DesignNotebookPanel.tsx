import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import {
  designNotebookWorkbench,
  type DesignNotebookWorkbench,
} from '../../app/design-notebook'
import type { DesignNotebookEntry, DesignNotebookSection } from '../../types/design'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import styles from './DesignNotebookPanel.module.css'

const NOTEBOOK_REORDER_DOWN_THRESHOLD = 0.4
const NOTEBOOK_REORDER_UP_THRESHOLD = 0.6

interface DesignNotebookPanelProps {
  readonly workbench?: DesignNotebookWorkbench
}

type NotebookReorderKind = 'section' | 'entry'
type NotebookReorderDirection = 'up' | 'down'

interface NotebookReorderSession {
  readonly kind: NotebookReorderKind
  readonly pointerId: number
  readonly sourceId: string
  readonly grip: HTMLElement
  readonly selector: string
  direction: NotebookReorderDirection | null
  lastClientY: number
  latestIds: readonly string[]
}

export function DesignNotebookPanel({
  workbench = designNotebookWorkbench,
}: DesignNotebookPanelProps) {
  const lang = locale.value
  const view = workbench.view.value
  const listRef = useRef<HTMLDivElement>(null)
  const reorderSessionRef = useRef<NotebookReorderSession | null>(null)
  const reorderCleanupRef = useRef<(() => void) | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [addCurrentSectionId, setAddCurrentSectionId] = useState<string>('')
  const [sectionReorderPreviewIds, setSectionReorderPreviewIds] = useState<readonly string[] | null>(null)
  const [entryReorderPreviewPaths, setEntryReorderPreviewPaths] = useState<readonly string[] | null>(null)

  useEffect(() => {
    void workbench.load()
  }, [workbench])

  useEffect(() => {
    return () => reorderCleanupRef.current?.()
  }, [])

  const orderedSections = orderItemsForPreview(view.sections, sectionReorderPreviewIds, (section) => section.id)
  const orderedVisibleEntries = orderItemsForPreview(view.visibleEntries, entryReorderPreviewPaths, (entry) => entry.path)
  const unsectionedEntries = orderedVisibleEntries.filter((entry) => entry.section_id === null)
  const sectionEntries = (sectionId: string) =>
    orderedVisibleEntries.filter((entry) => entry.section_id === sectionId)

  function createSection(): void {
    const name = newSectionName.trim()
    if (!name) return
    void workbench.createSection(name).then(() => {
      setNewSectionName('')
    })
  }

  function beginRename(section: DesignNotebookSection): void {
    setRenamingSectionId(section.id)
    setRenameDraft(section.name)
  }

  function saveRename(sectionId: string): void {
    const name = renameDraft.trim()
    if (!name) return
    void workbench.renameSection(sectionId, name).then(() => {
      setRenamingSectionId(null)
      setRenameDraft('')
    })
  }

  function cancelRename(): void {
    setRenamingSectionId(null)
    setRenameDraft('')
  }

  function beginSectionReorder(sectionId: string, event: PointerEvent): void {
    beginNotebookReorder({
      kind: 'section',
      sourceId: sectionId,
      event,
      ids: orderedSections.map((section) => section.id),
      selector: '[data-notebook-section-row]',
    })
  }

  function beginEntryReorder(path: string, event: PointerEvent): void {
    const source = orderedVisibleEntries.find((entry) => entry.path === path)
    const sectionKey = notebookEntrySectionKey(source?.section_id ?? null)
    beginNotebookReorder({
      kind: 'entry',
      sourceId: path,
      event,
      ids: orderedVisibleEntries
        .filter((entry) => notebookEntrySectionKey(entry.section_id) === sectionKey)
        .map((entry) => entry.path),
      selector: `[data-notebook-entry-row][data-notebook-entry-section="${sectionKey}"]`,
    })
  }

  function beginNotebookReorder({
    kind,
    sourceId,
    event,
    ids,
    selector,
  }: {
    readonly kind: NotebookReorderKind
    readonly sourceId: string
    readonly event: PointerEvent
    readonly ids: readonly string[]
    readonly selector: string
  }): void {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return
    event.preventDefault()
    event.stopPropagation()

    reorderSessionRef.current = {
      kind,
      pointerId: event.pointerId,
      sourceId,
      grip: event.currentTarget,
      selector,
      direction: null,
      lastClientY: event.clientY,
      latestIds: ids,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    installReorderDocumentListeners()
    previewNotebookReorder(kind, ids)
  }

  function installReorderDocumentListeners(): void {
    clearReorderDocumentListeners()

    const onMove = (event: PointerEvent) => updateNotebookReorder(event)
    const onUp = (event: PointerEvent) => finishNotebookReorder(event)
    const onCancel = (event: PointerEvent) => abortNotebookReorder(event)

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    reorderCleanupRef.current = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      reorderCleanupRef.current = null
    }
  }

  function clearReorderDocumentListeners(): void {
    reorderCleanupRef.current?.()
  }

  function updateNotebookReorder(event: PointerEvent): void {
    const session = reorderSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    const direction = reorderDirectionForPointer(session, event.clientY)
    session.direction = direction
    session.lastClientY = event.clientY
    const ids = reorderIdsForPointer(session, event.clientY, direction)
    session.latestIds = ids
    previewNotebookReorder(session.kind, ids)
  }

  function finishNotebookReorder(event: PointerEvent): void {
    const session = reorderSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    clearReorderDocumentListeners()
    reorderSessionRef.current = null
    releaseNotebookReorderPointerCapture(session.grip, event.pointerId)

    const currentIds = currentReorderIds(session)
    if (sameIdOrder(currentIds, session.latestIds)) {
      previewNotebookReorder(session.kind, null)
      return
    }
    commitNotebookReorder(session.kind, session.latestIds)
  }

  function abortNotebookReorder(event: PointerEvent): void {
    const session = reorderSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    clearReorderDocumentListeners()
    reorderSessionRef.current = null
    releaseNotebookReorderPointerCapture(session.grip, event.pointerId)
    previewNotebookReorder(session.kind, null)
  }

  function releaseNotebookReorderPointerCapture(grip: HTMLElement, pointerId: number): void {
    try {
      grip.releasePointerCapture(pointerId)
    } catch {
      // Row reflow can drop capture before pointerup; document listeners own cleanup.
    }
  }

  function reorderDirectionForPointer(
    session: NotebookReorderSession,
    clientY: number,
  ): NotebookReorderDirection | null {
    if (clientY > session.lastClientY) return 'down'
    if (clientY < session.lastClientY) return 'up'
    return session.direction
  }

  function reorderIdsForPointer(
    session: NotebookReorderSession,
    clientY: number,
    direction: NotebookReorderDirection | null,
  ): readonly string[] {
    const rows = [...listRef.current?.querySelectorAll<HTMLElement>(session.selector) ?? []]
    const visibleIds = rows
      .map((row) => notebookRowIdForKind(row, session.kind))
      .filter((id): id is string => Boolean(id))
    const displayedIds = visibleIds.length > 0 ? visibleIds : session.latestIds
    const withoutSourceIds = displayedIds.filter((id) => id !== session.sourceId)
    const targetRows = rows.filter((row) => notebookRowIdForKind(row, session.kind) !== session.sourceId)
    const threshold = reorderThreshold(direction)
    let insertIndex = withoutSourceIds.length

    for (let index = 0; index < targetRows.length; index += 1) {
      const rect = targetRows[index]!.getBoundingClientRect()
      if (clientY < rect.top + rect.height * threshold) {
        insertIndex = index
        break
      }
    }

    return [
      ...withoutSourceIds.slice(0, insertIndex),
      session.sourceId,
      ...withoutSourceIds.slice(insertIndex),
    ]
  }

  function reorderThreshold(direction: NotebookReorderDirection | null): number {
    if (direction === 'down') return NOTEBOOK_REORDER_DOWN_THRESHOLD
    if (direction === 'up') return NOTEBOOK_REORDER_UP_THRESHOLD
    return 0.5
  }

  function currentReorderIds(session: NotebookReorderSession): readonly string[] {
    if (session.kind === 'section') return orderedSections.map((section) => section.id)
    const source = orderedVisibleEntries.find((entry) => entry.path === session.sourceId)
    const sectionKey = notebookEntrySectionKey(source?.section_id ?? null)
    return orderedVisibleEntries
      .filter((entry) => notebookEntrySectionKey(entry.section_id) === sectionKey)
      .map((entry) => entry.path)
  }

  function previewNotebookReorder(kind: NotebookReorderKind, ids: readonly string[] | null): void {
    if (kind === 'section') setSectionReorderPreviewIds(ids)
    else setEntryReorderPreviewPaths(ids)
  }

  function commitNotebookReorder(kind: NotebookReorderKind, ids: readonly string[]): void {
    previewNotebookReorder(kind, ids)
    const persist = kind === 'section'
      ? workbench.reorderSections(ids)
      : workbench.reorderEntries(ids)
    void persist.finally(() => {
      previewNotebookReorder(kind, null)
    })
  }

  return (
    <section className={styles.panel} aria-label={t('designNotebook.title')}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>{t('designNotebook.title')}</h2>
          <span className={styles.subtitle}>{t('designNotebook.allDesigns')}</span>
        </div>
        <span className={styles.count} aria-label={t('designNotebook.visibleCount', { count: view.visibleEntries.length })}>
          {view.visibleEntries.length}
        </span>
      </header>

      <div className={styles.searchRegion}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            type="search"
            aria-label={t('designNotebook.searchLabel')}
            placeholder={t('designNotebook.searchPlaceholder')}
            value={view.searchQuery}
            onInput={(event) => {
              workbench.setSearchQuery((event.currentTarget as HTMLInputElement).value)
            }}
          />
          {view.searchQuery.length > 0 && (
            <button
              className={styles.searchClear}
              type="button"
              aria-label={t('designNotebook.clearSearch')}
              onClick={() => workbench.setSearchQuery('')}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={styles.viewStrip} aria-label={t('designNotebook.viewsLabel')}>
        <button
          className={styles.viewPill}
          type="button"
          aria-label={t('designNotebook.allDesignsLabel')}
          aria-pressed={view.viewMode === 'all'}
          onClick={() => workbench.setViewMode('all')}
        >
          {t('designNotebook.allDesigns')}
        </button>
        <button
          className={styles.viewPill}
          type="button"
          aria-label={t('designNotebook.pinnedDesigns')}
          aria-pressed={view.viewMode === 'pinned'}
          onClick={() => workbench.setViewMode('pinned')}
        >
          {t('designNotebook.pinnedDesigns')}
        </button>
      </div>

      {view.canAddCurrentDesign && (
        <div className={styles.addCurrent}>
          <div className={styles.addCurrentText}>
            <span className={styles.addCurrentTitle}>{t('designNotebook.addCurrentTitle')}</span>
            <span className={styles.addCurrentHint}>
              {view.currentDesignPath
                ? t('designNotebook.addCurrentSavedHint')
                : t('designNotebook.addCurrentUnsavedHint')}
            </span>
          </div>
          <div className={styles.addCurrentActions}>
            {view.sections.length > 0 && (
              <Dropdown
                trigger={sectionNameForId(view.sections, addCurrentSectionId) ?? t('designNotebook.noSection')}
                items={[
                  { value: '', label: t('designNotebook.noSection') },
                  ...view.sections.map((section) => ({ value: section.id, label: section.name })),
                ]}
                value={addCurrentSectionId}
                onChange={setAddCurrentSectionId}
                ariaLabel={t('designNotebook.addCurrentSection')}
                className={styles.sectionDropdown}
                triggerClassName={styles.sectionDropdownTrigger}
                menuClassName={styles.sectionDropdownMenu}
                optionClassName={styles.sectionDropdownOption}
                preserveOverlays
              />
            )}
            <button
              className={styles.addCurrentButton}
              type="button"
              aria-label={t('designNotebook.addCurrentDesign')}
              onClick={() => {
                void workbench.addCurrentDesignToNotebook(addCurrentSectionId || null)
              }}
            >
              {t('designNotebook.addCurrentButton')}
            </button>
          </div>
        </div>
      )}

      <div className={styles.sectionCreate}>
        <input
          className={styles.sectionInput}
          aria-label={t('designNotebook.newSectionName')}
          value={newSectionName}
          placeholder={t('designNotebook.newSectionPlaceholder')}
          onInput={(event) => setNewSectionName((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              createSection()
            }
          }}
        />
        <button
          className={styles.sectionCreateButton}
          type="button"
          aria-label={t('designNotebook.createSection')}
          disabled={newSectionName.trim().length === 0}
          onClick={createSection}
        >
          {t('designNotebook.createSection')}
        </button>
      </div>

      <div ref={listRef} className={styles.list} role="list">
        {view.loading && view.entries.length === 0 ? (
          <div className={styles.feedback}>{t('designNotebook.loading')}</div>
        ) : view.loadError ? (
          <div className={styles.feedback}>{t('designNotebook.loadError')}</div>
        ) : view.entries.length === 0 ? (
          <EmptyState
            title={t('designNotebook.emptyTitle')}
            text={t('designNotebook.emptyText')}
          />
        ) : view.visibleEntries.length === 0 ? (
          <EmptyState
            title={t('designNotebook.noResultsTitle')}
            text={t('designNotebook.noResultsText')}
          />
        ) : (
          <>
            {unsectionedEntries.length > 0 && (
              <NotebookSectionGroup title={t('designNotebook.unsectioned')}>
                {unsectionedEntries.map((entry) => (
                  <NotebookRow
                    key={entry.path}
                    entry={entry}
                    lang={lang}
                    active={entry.path === view.activePath}
                    sections={view.sections}
                    onOpen={() => {
                      void workbench.openEntry(entry.path)
                    }}
                    onMove={(sectionId) => {
                      void workbench.moveEntryToSection(entry.path, sectionId)
                    }}
                    onPin={(pinned) => {
                      void workbench.setEntryPinned(entry.path, pinned)
                    }}
                    onReorderBegin={beginEntryReorder}
                  />
                ))}
              </NotebookSectionGroup>
            )}

            {orderedSections.map((section) => (
              <NotebookSectionGroup
                key={section.id}
                sectionId={section.id}
                title={section.name}
                onReorderBegin={beginSectionReorder}
                actions={renamingSectionId === section.id ? (
                  <div className={styles.sectionRenameControls}>
                    <input
                      className={styles.sectionInput}
                      aria-label={t('designNotebook.sectionName')}
                      value={renameDraft}
                      onInput={(event) => setRenameDraft((event.currentTarget as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          saveRename(section.id)
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                    <button
                      className={styles.sectionIconButton}
                      type="button"
                      aria-label={t('designNotebook.saveSectionName')}
                      disabled={renameDraft.trim().length === 0}
                      onClick={() => saveRename(section.id)}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      className={styles.sectionIconButton}
                      type="button"
                      aria-label={t('designNotebook.cancelRename')}
                      onClick={cancelRename}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ) : (
                  <div className={styles.sectionHeaderActions}>
                    <button
                      className={styles.sectionIconButton}
                      type="button"
                      aria-label={t('designNotebook.renameSection', { name: section.name })}
                      onClick={() => beginRename(section)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className={styles.sectionIconButton}
                      type="button"
                      aria-label={t('designNotebook.deleteSection', { name: section.name })}
                      onClick={() => {
                        void workbench.deleteSection(section.id)
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
              >
                {sectionEntries(section.id).map((entry) => (
                  <NotebookRow
                    key={entry.path}
                    entry={entry}
                    lang={lang}
                    active={entry.path === view.activePath}
                    sections={view.sections}
                    onOpen={() => {
                      void workbench.openEntry(entry.path)
                    }}
                    onMove={(sectionId) => {
                      void workbench.moveEntryToSection(entry.path, sectionId)
                    }}
                    onPin={(pinned) => {
                      void workbench.setEntryPinned(entry.path, pinned)
                    }}
                    onReorderBegin={beginEntryReorder}
                  />
                ))}
                {sectionEntries(section.id).length === 0 && (
                  <div className={styles.sectionEmpty}>{t('designNotebook.sectionEmpty')}</div>
                )}
              </NotebookSectionGroup>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function EmptyState({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
    </div>
  )
}

function sectionNameForId(
  sections: readonly DesignNotebookSection[],
  sectionId: string,
): string | null {
  return sections.find((section) => section.id === sectionId)?.name ?? null
}

function NotebookSectionGroup({
  sectionId,
  title,
  actions,
  onReorderBegin,
  children,
}: {
  readonly sectionId?: string
  readonly title: string
  readonly actions?: ComponentChildren
  readonly onReorderBegin?: (sectionId: string, event: PointerEvent) => void
  readonly children: ComponentChildren
}) {
  return (
    <section
      className={styles.sectionGroup}
      aria-label={title}
      data-notebook-section-row={sectionId}
    >
      <header className={styles.sectionHeader}>
        {sectionId && onReorderBegin && (
          <button
            className={styles.sectionReorderGrip}
            type="button"
            aria-label={t('designNotebook.reorderSection', { name: title })}
            onPointerDown={(event) => onReorderBegin(sectionId, event)}
          >
            <SixDotGripIcon />
          </button>
        )}
        <h3 className={styles.sectionTitle}>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  )
}

function NotebookRow({
  entry,
  lang,
  active,
  sections,
  onOpen,
  onMove,
  onPin,
  onReorderBegin,
}: {
  readonly entry: DesignNotebookEntry
  readonly lang: string
  readonly active: boolean
  readonly sections: readonly DesignNotebookSection[]
  readonly onOpen: () => void
  readonly onMove: (sectionId: string | null) => void
  readonly onPin: (pinned: boolean) => void
  readonly onReorderBegin: (path: string, event: PointerEvent) => void
}) {
  const date = formatDate(entry.updated_at, lang)
  const currentSectionName = sections.find((section) => section.id === entry.section_id)?.name
  const items: DropdownItem<string>[] = [
    { value: '', label: t('designNotebook.noSection') },
    ...sections.map((section) => ({ value: section.id, label: section.name })),
  ]

  return (
    <div
      className={`${styles.row}${active ? ` ${styles.rowActive}` : ''}`}
      role="listitem"
      data-notebook-entry-row={entry.path}
      data-notebook-entry-section={notebookEntrySectionKey(entry.section_id)}
    >
      <button
        className={styles.rowReorderGrip}
        type="button"
        aria-label={t('designNotebook.reorderDesign', { name: entry.name })}
        onPointerDown={(event) => onReorderBegin(entry.path, event)}
      >
        <SixDotGripIcon />
      </button>
      <button
        className={styles.rowOpen}
        type="button"
        aria-current={active ? 'true' : undefined}
        data-design-path={entry.path}
        onClick={onOpen}
      >
        <span className={styles.rowMain}>
          <span className={styles.rowName}>{entry.name}</span>
          <span className={styles.rowPath}>{entry.path}</span>
        </span>
        <span className={styles.rowMeta}>
          {date}
          {entry.plant_count > 0 && (
            <>
              <span className={styles.metaSeparator} aria-hidden="true">·</span>
              <span>{t('designNotebook.plantCount', { count: entry.plant_count })}</span>
            </>
          )}
        </span>
      </button>
      <div className={styles.rowActions}>
        <button
          className={styles.rowIconButton}
          type="button"
          aria-label={t(entry.pinned ? 'designNotebook.unpinDesign' : 'designNotebook.pinDesign', { name: entry.name })}
          aria-pressed={entry.pinned}
          onClick={() => onPin(!entry.pinned)}
        >
          <PinIcon pinned={entry.pinned} />
        </button>
        <Dropdown
          trigger={currentSectionName ?? t('designNotebook.noSection')}
          items={items}
          value={entry.section_id ?? ''}
          onChange={(value) => onMove(value === '' ? null : value)}
          ariaLabel={t('designNotebook.moveToSection', { name: entry.name })}
          className={styles.sectionDropdown}
          triggerClassName={styles.sectionDropdownTrigger}
          menuClassName={styles.sectionDropdownMenu}
          optionClassName={styles.sectionDropdownOption}
          preserveOverlays
        />
      </div>
    </div>
  )
}

function orderItemsForPreview<T>(
  items: readonly T[],
  orderedIds: readonly string[] | null,
  idForItem: (item: T) => string,
): readonly T[] {
  if (!orderedIds) return items
  const byId = new Map(items.map((item) => [idForItem(item), item]))
  const ordered: T[] = []
  for (const id of orderedIds) {
    const item = byId.get(id)
    if (!item) continue
    ordered.push(item)
    byId.delete(id)
  }
  return [...ordered, ...byId.values()]
}

function notebookEntrySectionKey(sectionId: string | null): string {
  return sectionId ?? 'unsectioned'
}

function notebookRowIdForKind(row: HTMLElement, kind: NotebookReorderKind): string | undefined {
  return kind === 'section'
    ? row.dataset.notebookSectionRow
    : row.dataset.notebookEntryRow
}

function sameIdOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function SixDotGripIcon() {
  return (
    <span className={styles.reorderGripDots} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  )
}

function PinIcon({ pinned }: { readonly pinned: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill={pinned ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M4.2 1.8h4.6l-.7 3 2.1 2.2v1H7.3L6.8 11H6.2L5.7 8H2.8V7l2.1-2.2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M8.7 2.1 10.9 4.3 4.6 10.6l-2.6.4.4-2.6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2.3 3.7h8.4M5.2 5.4v3.8M7.8 5.4v3.8M4 3.7l.5-1h4l.5 1M3.4 3.7l.4 7h5.4l.4-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="m2.6 6.7 2.4 2.2 5.4-5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M3.5 3.5 9.5 9.5M9.5 3.5 3.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
