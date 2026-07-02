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

interface DesignNotebookPanelProps {
  readonly workbench?: DesignNotebookWorkbench
}

type NotebookDropPosition = 'before' | 'after' | 'inside'

interface NotebookDropTarget {
  readonly sectionId: string | null
  readonly beforePath: string | null
  readonly rowPath: string | null
  readonly position: NotebookDropPosition
}

export function DesignNotebookPanel({
  workbench = designNotebookWorkbench,
}: DesignNotebookPanelProps) {
  const lang = locale.value
  const view = workbench.view.value
  const renameInputRef = useRef<HTMLInputElement>(null)
  const draggedPathRef = useRef<string | null>(null)
  const dropTargetRef = useRef<NotebookDropTarget | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [sectionEditorOpen, setSectionEditorOpen] = useState(false)
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [addCurrentSectionId, setAddCurrentSectionId] = useState<string>('')
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<NotebookDropTarget | null>(null)

  useEffect(() => {
    void workbench.load()
  }, [workbench])

  useEffect(() => {
    if (!renamingSectionId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingSectionId])

  const orderedSections = view.sections
  const orderedEntries = entriesInNotebookDisplayOrder(view.entries, orderedSections)
  const unsectionedEntries = entriesForSection(orderedEntries, null)
  const shouldShowUnsectioned = unsectionedEntries.length > 0 || draggedPath !== null
  const addSectionItems: DropdownItem<string>[] = [
    { value: '', label: t('designNotebook.noSection') },
    ...view.sections.map((section) => ({ value: section.id, label: section.name })),
  ]

  function createSection(): void {
    const name = newSectionName.trim()
    if (!name) return
    void workbench.createSection(name).then(() => {
      setNewSectionName('')
      setSectionEditorOpen(false)
    })
  }

  function beginRename(section: DesignNotebookSection): void {
    setRenamingSectionId(section.id)
    setRenameDraft(section.name)
  }

  function commitRename(sectionId: string): void {
    const name = renameDraft.trim()
    if (!name) {
      cancelRename()
      return
    }
    void workbench.renameSection(sectionId, name).then(() => {
      setRenamingSectionId(null)
      setRenameDraft('')
    })
  }

  function cancelRename(): void {
    setRenamingSectionId(null)
    setRenameDraft('')
  }

  function beginEntryDrag(path: string, event: DragEvent): void {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', path)
    }
    draggedPathRef.current = path
    dropTargetRef.current = null
    setDraggedPath(path)
    setDropTarget(null)
  }

  function updateEntryDropTarget(entry: DesignNotebookEntry, event: DragEvent): void {
    const sourcePath = draggedPathRef.current
    if (!sourcePath || sourcePath === entry.path || !(event.currentTarget instanceof HTMLElement)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setCurrentDropTarget(dropTargetForEntry(entry, event.currentTarget, event.clientY, orderedEntries, sourcePath))
  }

  function updateSectionDropTarget(sectionId: string | null, event: DragEvent): void {
    if (!draggedPathRef.current) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setCurrentDropTarget({
      sectionId,
      beforePath: null,
      rowPath: null,
      position: 'inside',
    })
  }

  function dropEntry(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const sourcePath = draggedPathRef.current
    const target = dropTargetRef.current
    clearDragState()
    if (!sourcePath || !target) return

    const currentEntries = entriesInNotebookDisplayOrder(view.entries, orderedSections)
    const source = currentEntries.find((entry) => entry.path === sourcePath)
    const nextEntries = entriesAfterDrop(currentEntries, orderedSections, sourcePath, target)
    if (!source || !nextEntries) return

    const currentPaths = currentEntries.map((entry) => entry.path)
    const nextPaths = nextEntries.map((entry) => entry.path)
    const sectionChanged = source.section_id !== target.sectionId
    const orderChanged = !sameIdOrder(currentPaths, nextPaths)
    if (!sectionChanged && !orderChanged) return

    void (async () => {
      if (sectionChanged) {
        await workbench.moveEntryToSection(sourcePath, target.sectionId)
      }
      if (orderChanged) {
        await workbench.reorderEntries(nextPaths)
      }
    })()
  }

  function clearDragState(): void {
    draggedPathRef.current = null
    dropTargetRef.current = null
    setDraggedPath(null)
    setDropTarget(null)
  }

  function setCurrentDropTarget(target: NotebookDropTarget): void {
    dropTargetRef.current = target
    setDropTarget(target)
  }

  return (
    <section className={styles.panel} aria-label={t('designNotebook.title')}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{t('designNotebook.title')}</h2>
            <span className={styles.count} aria-label={t('designNotebook.visibleCount', { count: view.visibleEntries.length })}>
              {view.visibleEntries.length}
            </span>
          </div>
          <div className={styles.headerActions}>
            {view.canAddCurrentDesign && view.sections.length > 0 && (
              <Dropdown
                trigger={sectionNameForId(view.sections, addCurrentSectionId) ?? t('designNotebook.noSection')}
                items={addSectionItems}
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
            {view.canAddCurrentDesign && (
              <button
                className={styles.headerButton}
                type="button"
                aria-label={t('designNotebook.addCurrentDesign')}
                onClick={() => {
                  void workbench.addCurrentDesignToNotebook(addCurrentSectionId || null)
                }}
              >
                <PlusIcon />
                <span>{t('designNotebook.addCurrentButton')}</span>
              </button>
            )}
            <button
              className={styles.headerButton}
              type="button"
              aria-label={t('designNotebook.newSectionAction')}
              aria-expanded={sectionEditorOpen}
              onClick={() => setSectionEditorOpen((open) => !open)}
            >
              <PlusIcon />
              <span>{t('designNotebook.newSectionAction')}</span>
            </button>
          </div>
        </div>

        {sectionEditorOpen && (
          <div className={styles.headerEditor}>
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
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSectionEditorOpen(false)
                  setNewSectionName('')
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
        )}
      </header>

      <div className={styles.list} role="list">
        {view.loading && view.entries.length === 0 ? (
          <div className={styles.feedback}>{t('designNotebook.loading')}</div>
        ) : view.loadError ? (
          <div className={styles.feedback}>{t('designNotebook.loadError')}</div>
        ) : view.entries.length === 0 ? (
          <EmptyState
            title={t('designNotebook.emptyTitle')}
            text={t('designNotebook.emptyText')}
          />
        ) : (
          <>
            {shouldShowUnsectioned && (
              <NotebookSectionGroup
                sectionId={null}
                title={t('designNotebook.unsectioned')}
                dropActive={isSectionDropTarget(dropTarget, null)}
                onDragOver={(event) => updateSectionDropTarget(null, event)}
                onDrop={dropEntry}
              >
                {unsectionedEntries.map((entry) => (
                  <NotebookRow
                    key={entry.path}
                    entry={entry}
                    lang={lang}
                    active={entry.path === view.activePath}
                    dragging={entry.path === draggedPath}
                    dropPosition={dropPositionForRow(dropTarget, entry.path)}
                    onOpen={() => {
                      void workbench.openEntry(entry.path)
                    }}
                    onRemove={() => {
                      void workbench.removeEntry(entry.path)
                    }}
                    onDragStart={(event) => beginEntryDrag(entry.path, event)}
                    onDragOver={(event) => updateEntryDropTarget(entry, event)}
                    onDrop={dropEntry}
                    onDragEnd={clearDragState}
                  />
                ))}
                {unsectionedEntries.length === 0 && (
                  <div className={styles.sectionEmpty}>{t('designNotebook.sectionEmpty')}</div>
                )}
              </NotebookSectionGroup>
            )}

            {orderedSections.map((section) => {
              const entries = entriesForSection(orderedEntries, section.id)
              const renaming = renamingSectionId === section.id

              return (
                <NotebookSectionGroup
                  key={section.id}
                  sectionId={section.id}
                  title={section.name}
                  titleEditor={renaming ? (
                    <input
                      ref={renameInputRef}
                      className={styles.sectionRenameInput}
                      aria-label={t('designNotebook.sectionName')}
                      value={renameDraft}
                      onInput={(event) => setRenameDraft((event.currentTarget as HTMLInputElement).value)}
                      onBlur={() => commitRename(section.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitRename(section.id)
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                  ) : undefined}
                  actions={!renaming && (
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
                  )}
                  dropActive={isSectionDropTarget(dropTarget, section.id)}
                  onTitleDoubleClick={() => beginRename(section)}
                  onDragOver={(event) => updateSectionDropTarget(section.id, event)}
                  onDrop={dropEntry}
                >
                  {entries.map((entry) => (
                    <NotebookRow
                      key={entry.path}
                      entry={entry}
                      lang={lang}
                      active={entry.path === view.activePath}
                      dragging={entry.path === draggedPath}
                      dropPosition={dropPositionForRow(dropTarget, entry.path)}
                      onOpen={() => {
                        void workbench.openEntry(entry.path)
                      }}
                      onRemove={() => {
                        void workbench.removeEntry(entry.path)
                      }}
                      onDragStart={(event) => beginEntryDrag(entry.path, event)}
                      onDragOver={(event) => updateEntryDropTarget(entry, event)}
                      onDrop={dropEntry}
                      onDragEnd={clearDragState}
                    />
                  ))}
                  {entries.length === 0 && (
                    <div className={styles.sectionEmpty}>{t('designNotebook.sectionEmpty')}</div>
                  )}
                </NotebookSectionGroup>
              )
            })}
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
  titleEditor,
  actions,
  dropActive,
  onTitleDoubleClick,
  onDragOver,
  onDrop,
  children,
}: {
  readonly sectionId: string | null
  readonly title: string
  readonly titleEditor?: ComponentChildren
  readonly actions?: ComponentChildren
  readonly dropActive: boolean
  readonly onTitleDoubleClick?: () => void
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly children: ComponentChildren
}) {
  return (
    <section
      className={classNames(styles.sectionGroup, dropActive && styles.sectionDropTarget)}
      aria-label={title}
      data-notebook-section-id={notebookEntrySectionKey(sectionId)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className={styles.sectionHeader}>
        {titleEditor ?? (
          <h3
            className={styles.sectionTitle}
            onDblClick={onTitleDoubleClick}
          >
            {title}
          </h3>
        )}
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
  dragging,
  dropPosition,
  onOpen,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  readonly entry: DesignNotebookEntry
  readonly lang: string
  readonly active: boolean
  readonly dragging: boolean
  readonly dropPosition: NotebookDropPosition | null
  readonly onOpen: () => void
  readonly onRemove: () => void
  readonly onDragStart: (event: DragEvent) => void
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly onDragEnd: () => void
}) {
  const date = formatDate(entry.updated_at, lang)

  return (
    <div
      className={classNames(
        styles.row,
        active && styles.rowActive,
        dragging && styles.rowDragging,
        dropPosition === 'before' && styles.rowDropBefore,
        dropPosition === 'after' && styles.rowDropAfter,
      )}
      role="listitem"
      draggable
      data-notebook-entry-row={entry.path}
      data-notebook-entry-section={notebookEntrySectionKey(entry.section_id)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
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
          aria-label={t('designNotebook.removeDesignFromNotebook', { name: entry.name })}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

function dropTargetForEntry(
  entry: DesignNotebookEntry,
  row: HTMLElement,
  clientY: number,
  entries: readonly DesignNotebookEntry[],
  sourcePath: string,
): NotebookDropTarget {
  const sectionId = entry.section_id
  const rect = row.getBoundingClientRect()
  const insertAfter = clientY >= rect.top + rect.height / 2
  const targetSectionEntries = entriesForSection(entries, sectionId)
    .filter((sectionEntry) => sectionEntry.path !== sourcePath)

  if (!insertAfter) {
    return {
      sectionId,
      beforePath: entry.path,
      rowPath: entry.path,
      position: 'before',
    }
  }

  const targetIndex = targetSectionEntries.findIndex((sectionEntry) => sectionEntry.path === entry.path)
  return {
    sectionId,
    beforePath: targetSectionEntries[targetIndex + 1]?.path ?? null,
    rowPath: entry.path,
    position: 'after',
  }
}

function entriesAfterDrop(
  entries: readonly DesignNotebookEntry[],
  sections: readonly DesignNotebookSection[],
  sourcePath: string,
  target: NotebookDropTarget,
): readonly DesignNotebookEntry[] | null {
  const source = entries.find((entry) => entry.path === sourcePath)
  if (!source) return null

  const sectionOrder: Array<string | null> = [null, ...sections.map((section) => section.id)]
  const entriesBySection = new Map<string, DesignNotebookEntry[]>()
  for (const sectionId of sectionOrder) {
    entriesBySection.set(notebookEntrySectionKey(sectionId), [])
  }

  for (const entry of entries) {
    if (entry.path === sourcePath) continue
    const key = notebookEntrySectionKey(entry.section_id)
    const sectionEntries = entriesBySection.get(key) ?? []
    sectionEntries.push(entry)
    entriesBySection.set(key, sectionEntries)
  }

  const movedEntry = { ...source, section_id: target.sectionId }
  const targetKey = notebookEntrySectionKey(target.sectionId)
  const targetEntries = entriesBySection.get(targetKey) ?? []
  const insertIndex = target.beforePath
    ? targetEntries.findIndex((entry) => entry.path === target.beforePath)
    : targetEntries.length
  targetEntries.splice(insertIndex < 0 ? targetEntries.length : insertIndex, 0, movedEntry)
  entriesBySection.set(targetKey, targetEntries)

  const orderedEntries: DesignNotebookEntry[] = []
  const orderedKeys = new Set<string>()
  for (const sectionId of sectionOrder) {
    const key = notebookEntrySectionKey(sectionId)
    orderedKeys.add(key)
    orderedEntries.push(...(entriesBySection.get(key) ?? []))
  }
  for (const [key, sectionEntries] of entriesBySection.entries()) {
    if (!orderedKeys.has(key)) orderedEntries.push(...sectionEntries)
  }
  return orderedEntries
}

function entriesInNotebookDisplayOrder(
  entries: readonly DesignNotebookEntry[],
  sections: readonly DesignNotebookSection[],
): readonly DesignNotebookEntry[] {
  const orderedEntries: DesignNotebookEntry[] = [
    ...entriesForSection(entries, null),
  ]
  for (const section of sections) {
    orderedEntries.push(...entriesForSection(entries, section.id))
  }
  return orderedEntries
}

function entriesForSection(
  entries: readonly DesignNotebookEntry[],
  sectionId: string | null,
): readonly DesignNotebookEntry[] {
  return entries.filter((entry) => entry.section_id === sectionId)
}

function isSectionDropTarget(target: NotebookDropTarget | null, sectionId: string | null): boolean {
  return target?.position === 'inside' && target.sectionId === sectionId
}

function dropPositionForRow(
  target: NotebookDropTarget | null,
  rowPath: string,
): NotebookDropPosition | null {
  return target?.rowPath === rowPath ? target.position : null
}

function notebookEntrySectionKey(sectionId: string | null): string {
  return sectionId ?? 'unsectioned'
}

function sameIdOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2.3 3.7h8.4M5.2 5.4v3.8M7.8 5.4v3.8M4 3.7l.5-1h4l.5 1M3.4 3.7l.4 7h5.4l.4-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 2.5v8M2.5 6.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
