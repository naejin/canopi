import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { renameLibraryItem, rerunAnalysis } from '../../../app/lidar/actions'
import { findAnalysis } from '../../../app/analyses/registry'
import { libraryItems, takenItemNames } from '../../../app/lidar/library-items'
import { lidarLibrary } from '../../../app/lidar/library-store'
import {
  analyzeItem,
  closeSiteDataDetails,
  openDataLibrary,
  openSiteDataDetails,
} from '../../../app/lidar/library-navigation'
import { locale } from '../../../app/settings/state'
import { t } from '../../../i18n'
import { closeDockPanel } from '../../shared/DockPanelHeader'
import { SurfaceHeader } from '../../shared/SurfaceHeader'
import { ItemDetails } from './ItemDetails'
import { isRunning } from './item-text'
import { LibraryItemNameField, isItemNameTaken } from './LibraryItemNameField'
import styles from './data-library.module.css'
import panel from './site-data.module.css'

/**
 * One site data item's details inside Layers, with Back to the list: a
 * result's provenance, whether it is out of date (Refresh), its processing
 * history, Run again with changes, and Rename. Deleting lives in the Data
 * library, which this view opens.
 */
export function SiteDataDetails({ id }: { readonly id: string }) {
  const snapshot = lidarLibrary.value
  const items = useMemo(() => libraryItems(snapshot), [snapshot, locale.value])
  const item = items.find((candidate) => candidate.id === id) ?? null
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const nameOf = (itemId: string) => items.find((candidate) => candidate.id === itemId)?.name ?? t('canvas.lidar.library.dataUnavailable')

  // Focus starts in the body: the rename field, or the first control.
  useEffect(() => {
    body.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [id, renaming])

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      after?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const input = item?.provenance ? items.find((candidate) => candidate.id === item.provenance!.inputs[0]?.item_id) : undefined
  const canRunAgain = !!item?.provenance && input?.status === 'ready' && !!findAnalysis(item.provenance.analysis_id)

  return (
    <aside className={panel.detailsPanel} aria-label={item?.name ?? t('canvas.lidar.library.itemGone')}>
      <SurfaceHeader
        title={item?.name ?? t('canvas.layers.layerPanel')}
        back={{ label: t('canvas.lidar.layers.backToLayers'), onClick: closeSiteDataDetails }}
        closeLabel={t('sidebar.close')}
        onClose={() => { closeSiteDataDetails(); closeDockPanel() }}
      />
      <div className={panel.detailsBody} ref={body}>
        {!item && <p className={styles.muted}>{t('canvas.lidar.library.itemGone')}</p>}
        {item && renaming && (
          <RenameForm
            name={item.name}
            taken={takenItemNames(snapshot, item.id)}
            busy={busy}
            error={error}
            onCancel={() => setRenaming(false)}
            onSubmit={(name) => void run(() => renameLibraryItem(item.id, name), () => setRenaming(false))}
          />
        )}
        {item && !renaming && <>
          <ItemDetails
            item={item}
            nameOf={nameOf}
            busy={busy || isRunning(item)}
            onRefresh={() => { if (item.provenance) void run(() => rerunAnalysis(item.provenance!.definition_id)) }}
            onOpenInput={openSiteDataDetails}
            actions={<>
              {canRunAgain && (
                <button type="button" onClick={() => analyzeItem(input!.id, {
                  attach: true,
                  analysisId: item.provenance!.analysis_id,
                  from: item.id,
                })}>
                  {t('canvas.lidar.library.runAgainWithChanges')}
                </button>
              )}
              {item.role === 'Source' && item.status === 'ready' && (
                <button type="button" onClick={() => analyzeItem(item.id, { attach: true })}>{t('canvas.lidar.library.analyze')}</button>
              )}
              {item.status === 'ready' && (
                <button type="button" onClick={() => setRenaming(true)}>{t('canvas.lidar.library.renameEllipsis')}</button>
              )}
              <button type="button" onClick={() => openDataLibrary(item.id)}>{t('canvas.lidar.layers.openInLibrary')}</button>
            </>}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>}
      </div>
    </aside>
  )
}

function RenameForm({ name: initialName, taken, busy, error, onCancel, onSubmit }: {
  readonly name: string
  readonly taken: ReadonlySet<string>
  readonly busy: boolean
  readonly error: string | null
  onCancel(): void
  onSubmit(name: string): void
}) {
  const [name, setName] = useState(initialName)
  const ready = name.trim() !== '' && !isItemNameTaken(name, taken)
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault()
      if (ready) onSubmit(name.trim())
    }}>
      <LibraryItemNameField value={name} taken={taken} onInput={setName} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <button type="button" className={styles.dialogButton} onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        <button type="submit" className={`${styles.dialogButton} ${styles.primary}`} disabled={busy || !ready}>{t('canvas.lidar.library.saveName')}</button>
      </div>
    </form>
  )
}
