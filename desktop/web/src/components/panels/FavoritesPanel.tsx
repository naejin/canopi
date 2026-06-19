import { useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { savedObjectStampWorkbench } from '../../app/saved-object-stamps'
import {
  clearSavedObjectStampDragSource,
  writeSavedObjectStampDragData,
} from '../../canvas/saved-object-stamp-source'
import type { SavedObjectStamp } from '../../types/saved-object-stamps'
import { PlantRow } from '../plant-db/PlantRow'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import { SavedStampsPrototype, shouldShowSavedStampsPrototype } from './SavedStampsPrototype'
import styles from './FavoritesPanel.module.css'

export function FavoritesPanel() {
  const favoritesView = speciesCatalogWorkbench.favorites.value
  const favoritesRevision = favoritesView.revision
  const savedStampsView = savedObjectStampWorkbench.library.value
  const savedStampSelection = savedObjectStampWorkbench.selection.value
  const lang = locale.value
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value

  useEffect(() => {
    void speciesCatalogWorkbench.loadFavorites()
  }, [favoritesRevision, lang])

  useEffect(() => {
    void savedObjectStampWorkbench.loadLibrary()
  }, [lang])

  const items = favoritesView.items
  const count = items.length
  const isLoading = favoritesView.loading
  const savedStampItems = savedStampsView.items

  return (
    <div className={styles.panel}>
      {/* Search + list view */}
      <div
        className={`${styles.main} ${selected !== null ? plantDetailStyles.detailHidden : ''}`}
        aria-hidden={selected !== null}
      >
        {/* Header — always visible */}
        <div className={styles.header}>
          <span className={styles.title}>{t('nav.favorites')}</span>
          {count > 0 && (
            <span className={styles.count}>{count}</span>
          )}
        </div>

        {/* Content area */}
        {isLoading ? (
          <div className={styles.loading} aria-live="polite" aria-busy="true">
            {t('plantDb.loading')}
          </div>
        ) : count === 0 ? (
          <div className={styles.empty} aria-live="polite">
            <svg className={styles.emptyIcon} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className={styles.emptyTitle}>{t('favorites.empty')}</span>
            <span className={styles.emptyHint}>{t('favorites.emptyHint')}</span>
          </div>
        ) : (
          <div className={styles.list} role="list" aria-label={t('nav.favorites')}>
            {items.map((plant) => (
              <PlantRow key={plant.canonical_name} plant={plant} />
            ))}
          </div>
        )}

        {shouldShowSavedStampsPrototype() ? (
          <SavedStampsPrototype stamps={savedStampItems} />
        ) : (
          <section className={styles.savedStampsSection} aria-labelledby="saved-object-stamps-title">
            <div className={styles.savedStampsHeader}>
              <div className={styles.savedStampsTitleGroup}>
                <span id="saved-object-stamps-title" className={styles.title}>
                  {t('savedObjectStamps.title')}
                </span>
                <span className={styles.savedStampsDescription}>
                  {t('savedObjectStamps.description')}
                </span>
              </div>
              {savedStampsView.items.length > 0 && (
                <span className={styles.count}>{savedStampsView.items.length}</span>
              )}
            </div>
            <div className={styles.savedStampsActions}>
              <button
                type="button"
                className={styles.saveStampButton}
                disabled={!savedStampSelection.canSave}
                onClick={() => void savedObjectStampWorkbench.saveCurrentSelection()}
              >
                {t('savedObjectStamps.saveSelection')}
              </button>
              <button
                type="button"
                className={styles.importStampButton}
                onClick={() => void savedObjectStampWorkbench.importStampFile()}
              >
                {t('savedObjectStamps.import')}
              </button>
            </div>
            {!savedStampSelection.canSave && (
              <span className={styles.savedStampsHint}>
                {t('savedObjectStamps.selectHint')}
              </span>
            )}
            {savedStampsView.loading ? (
              <div className={styles.savedStampsLoading} aria-live="polite" aria-busy="true">
                {t('savedObjectStamps.loading')}
              </div>
            ) : savedStampsView.items.length === 0 ? (
              <div className={styles.savedStampsEmpty} aria-live="polite">
                {t('savedObjectStamps.empty')}
              </div>
            ) : (
              <div className={styles.savedStampsList} role="list" aria-label={t('savedObjectStamps.title')}>
                {savedStampItems.map((stamp) => (
                  <SavedObjectStampRow
                    key={stamp.id}
                    stamp={stamp}
                    stamps={savedStampItems}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Detail card — slides in when a row is clicked */}
      {selected !== null && (
        <div className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </div>
  )
}

function SavedObjectStampRow({
  stamp,
  stamps,
}: {
  stamp: SavedObjectStamp
  stamps: readonly SavedObjectStamp[]
}) {
  const [draftName, setDraftName] = useState(stamp.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    setDraftName(stamp.name)
  }, [stamp.name])

  function commitRename(): void {
    const next = draftName.trim()
    if (next.length === 0) {
      setDraftName(stamp.name)
      return
    }
    if (next !== stamp.name) {
      void savedObjectStampWorkbench.renameStamp(stamp.id, next)
    }
  }

  function handleGripDragStart(event: DragEvent): void {
    event.stopPropagation()
    const { dataTransfer } = event
    if (!dataTransfer) return
    dataTransfer.setData('application/x-canopi-saved-stamp-reorder', stamp.id)
    dataTransfer.setData('text/plain', stamp.id)
    dataTransfer.effectAllowed = 'move'
  }

  function handleStampDragStart(event: DragEvent): void {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('button, input')) {
      event.preventDefault()
      return
    }
    if (!writeSavedObjectStampDragData(event.dataTransfer, stamp)) {
      event.preventDefault()
    }
  }

  function handleStampDragEnd(): void {
    clearSavedObjectStampDragSource()
  }

  function handleDragOver(event: DragEvent): void {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('application/x-canopi-saved-stamp-reorder')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(event: DragEvent): void {
    const sourceId = event.dataTransfer?.getData('application/x-canopi-saved-stamp-reorder')
    if (!sourceId || sourceId === stamp.id) return
    event.preventDefault()
    const nextIds = moveBefore(stamps.map((item) => item.id), sourceId, stamp.id)
    void savedObjectStampWorkbench.reorderStamps(nextIds)
  }

  return (
    <div
      className={styles.savedStampRow}
      role="listitem"
      data-saved-stamp-row={stamp.id}
      draggable
      onDragStart={handleStampDragStart}
      onDragEnd={handleStampDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className={styles.savedStampGrip}
        draggable
        aria-label={t('savedObjectStamps.reorderLabel')}
        onDragStart={handleGripDragStart}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <div className={styles.savedStampContent}>
        <input
          className={styles.savedStampNameInput}
          aria-label={t('savedObjectStamps.renameLabel')}
          value={draftName}
          onInput={(event) => setDraftName((event.currentTarget as HTMLInputElement).value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitRename()
              ;(event.currentTarget as HTMLInputElement).blur()
            }
            if (event.key === 'Escape') {
              setDraftName(stamp.name)
              ;(event.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
        <span className={styles.savedStampSummary}>{savedStampSummary(stamp)}</span>
      </div>
      <div className={styles.savedStampActions}>
        <button
          type="button"
          className={styles.savedStampPrimaryButton}
          onClick={() => savedObjectStampWorkbench.placeStamp(stamp)}
        >
          {t('savedObjectStamps.place')}
        </button>
        <button
          type="button"
          className={styles.savedStampSecondaryButton}
          onClick={() => void savedObjectStampWorkbench.exportStamp(stamp)}
        >
          {t('savedObjectStamps.export')}
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className={styles.savedStampDangerButton}
              onClick={() => void savedObjectStampWorkbench.deleteStamp(stamp.id)}
            >
              {t('savedObjectStamps.confirmDelete')}
            </button>
            <button
              type="button"
              className={styles.savedStampSecondaryButton}
              onClick={() => setConfirmingDelete(false)}
            >
              {t('savedObjectStamps.cancelDelete')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.savedStampSecondaryButton}
            onClick={() => setConfirmingDelete(true)}
          >
            {t('savedObjectStamps.delete')}
          </button>
        )}
      </div>
    </div>
  )
}

function moveBefore(ids: string[], sourceId: string, targetId: string): string[] {
  const withoutSource = ids.filter((id) => id !== sourceId)
  const targetIndex = withoutSource.indexOf(targetId)
  if (targetIndex < 0) return ids
  return [
    ...withoutSource.slice(0, targetIndex),
    sourceId,
    ...withoutSource.slice(targetIndex),
  ]
}

function savedStampSummary(stamp: SavedObjectStamp): string {
  try {
    const payload = JSON.parse(stamp.payload_json) as {
      plants?: unknown[]
      zones?: unknown[]
      annotations?: unknown[]
    }
    const parts = [
      countPart(payload.plants?.length ?? 0, 'summaryPlantOne', 'summaryPlantOther'),
      countPart(payload.zones?.length ?? 0, 'summaryZoneOne', 'summaryZoneOther'),
      countPart(payload.annotations?.length ?? 0, 'summaryAnnotationOne', 'summaryAnnotationOther'),
    ].filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(' · ') : t('savedObjectStamps.summaryEmpty')
  } catch {
    return t('savedObjectStamps.summaryUnavailable')
  }
}

function countPart(
  count: number,
  singularKey: string,
  pluralKey: string,
): string | null {
  if (count <= 0) return null
  const key = count === 1 ? singularKey : pluralKey
  return t(`savedObjectStamps.${key}`, { count })
}
