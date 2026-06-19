import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import {
  MIN_FAVORITES_FRAME_HEIGHT,
  locale,
  savedStampsFrameHeight,
} from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { savedObjectStampWorkbench } from '../../app/saved-object-stamps'
import {
  createSavedObjectStampThumbnailSignature,
  SAVED_OBJECT_STAMP_THUMBNAIL_HEIGHT,
  SAVED_OBJECT_STAMP_THUMBNAIL_WIDTH,
} from '../../app/saved-object-stamps/thumbnail-renderer'
import { commitSavedStampsFrameHeight } from '../../app/favorites/controller'
import {
  clearSavedObjectStampDragSource,
  writeSavedObjectStampDragData,
} from '../../canvas/saved-object-stamp-source'
import type { SavedObjectStamp } from '../../types/saved-object-stamps'
import { PlantRow } from '../plant-db/PlantRow'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import { SavedStampsPrototype, shouldShowSavedStampsPrototype } from './SavedStampsPrototype'
import styles from './FavoritesPanel.module.css'

const SAVED_STAMP_PREVIEW_DELAY_MS = 120
const SAVED_STAMP_PREVIEW_GAP = 8
const SAVED_STAMP_PREVIEW_MARGIN = 8

interface SavedStampPreview {
  readonly stamp: SavedObjectStamp
  readonly anchorRect: DOMRect
}

export function FavoritesPanel() {
  const favoritesView = speciesCatalogWorkbench.favorites.value
  const favoritesRevision = favoritesView.revision
  const savedStampsView = savedObjectStampWorkbench.library.value
  const savedStampSelection = savedObjectStampWorkbench.selection.value
  const lang = locale.value
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value
  const mainRef = useRef<HTMLDivElement>(null)
  const savedStampsFrameRef = useRef<HTMLElement>(null)
  const previewTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const [preview, setPreview] = useState<SavedStampPreview | null>(null)

  useEffect(() => {
    void speciesCatalogWorkbench.loadFavorites()
  }, [favoritesRevision, lang])

  useEffect(() => {
    void savedObjectStampWorkbench.loadLibrary()
  }, [lang])

  useEffect(() => {
    return () => clearPreviewTimer(previewTimerRef)
  }, [])

  const items = favoritesView.items
  const count = items.length
  const isLoading = favoritesView.loading
  const savedStampItems = savedStampsView.items

  function showStampPreview(stamp: SavedObjectStamp, anchor: HTMLElement): void {
    clearPreviewTimer(previewTimerRef)
    setPreview({
      stamp,
      anchorRect: anchor.getBoundingClientRect(),
    })
  }

  function scheduleStampPreview(stamp: SavedObjectStamp, anchor: HTMLElement): void {
    clearPreviewTimer(previewTimerRef)
    previewTimerRef.current = globalThis.setTimeout(() => {
      previewTimerRef.current = null
      setPreview({
        stamp,
        anchorRect: anchor.getBoundingClientRect(),
      })
    }, SAVED_STAMP_PREVIEW_DELAY_MS)
  }

  function hideStampPreview(): void {
    clearPreviewTimer(previewTimerRef)
    setPreview(null)
  }

  return (
    <div className={styles.panel}>
      {/* Search + list view */}
      <div
        ref={mainRef}
        className={`${styles.main} ${selected !== null ? plantDetailStyles.detailHidden : ''}`}
        data-favorites-main
        aria-hidden={selected !== null}
      >
        {/* Header — always visible */}
        <div className={styles.header}>
          <span className={styles.title}>{t('nav.favorites')}</span>
        </div>

        <section
          className={styles.plantsFrame}
          data-favorites-plants-frame
          aria-labelledby="favorite-plants-title"
        >
          <div className={styles.frameHeader}>
            <span id="favorite-plants-title" className={styles.title}>{t('canvas.layers.plants')}</span>
            {count > 0 && (
              <span className={styles.count}>{count}</span>
            )}
          </div>
          <div className={styles.plantsFrameBody}>
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
              <div className={styles.list} role="list" aria-label={t('canvas.layers.plants')}>
                {items.map((plant) => (
                  <PlantRow key={plant.canonical_name} plant={plant} variant="favorites" />
                ))}
              </div>
            )}
          </div>
        </section>

        {shouldShowSavedStampsPrototype() ? (
          <SavedStampsPrototype stamps={savedStampItems} />
        ) : (
          <>
            <SavedStampsResizeHandle
              mainRef={mainRef}
              frameRef={savedStampsFrameRef}
            />
            <section
              ref={savedStampsFrameRef}
              className={styles.savedStampsSection}
              data-saved-stamps-frame
              aria-labelledby="saved-object-stamps-title"
              style={{ height: `${resolveSavedStampsFrameHeight(savedStampsFrameHeight.value, mainRef.current)}px` }}
            >
            <div className={styles.frameHeader}>
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
                    onPreviewRequest={showStampPreview}
                    onPreviewSchedule={scheduleStampPreview}
                    onPreviewClear={hideStampPreview}
                  />
                ))}
              </div>
            )}
          </section>
          </>
        )}
      </div>

      <SavedStampRecognitionOverlay preview={preview} panelRef={mainRef} />

      {/* Detail card — slides in when a row is clicked */}
      {selected !== null && (
        <div className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </div>
  )
}

function SavedStampsResizeHandle({
  mainRef,
  frameRef,
}: {
  mainRef: { current: HTMLDivElement | null }
  frameRef: { current: HTMLElement | null }
}) {
  const handleRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<((commit: boolean) => void) | null>(null)

  useEffect(() => {
    return () => { cleanupRef.current?.(false) }
  }, [])

  return (
    <div
      ref={handleRef}
      className={styles.savedStampsResizeHandle}
      role="separator"
      aria-orientation="horizontal"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()

        const handle = handleRef.current
        const frame = frameRef.current
        if (!handle || !frame) return
        handle.setPointerCapture(event.pointerId)

        const startY = event.clientY
        const startHeight = currentSavedStampsFrameHeight(frame)
        const pointerId = event.pointerId
        let lastClientY = event.clientY

        const clampHeight = (clientY: number) =>
          resolveSavedStampsFrameHeight(startHeight + (startY - clientY), mainRef.current)

        const onMove = (moveEvent: PointerEvent) => {
          lastClientY = moveEvent.clientY
          frame.style.height = `${clampHeight(moveEvent.clientY)}px`
        }

        let cleaned = false
        const cleanup = (commit: boolean) => {
          if (cleaned) return
          cleaned = true
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', onUp)
          handle.removeEventListener('lostpointercapture', onLost)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          if (commit) commitSavedStampsFrameHeight(clampHeight(lastClientY))
          cleanupRef.current = null
        }

        const onUp = (upEvent: PointerEvent) => {
          lastClientY = upEvent.clientY
          handle.releasePointerCapture(pointerId)
          cleanup(true)
        }

        const onLost = () => {
          cleanup(true)
        }

        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
        handle.addEventListener('lostpointercapture', onLost)
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
        cleanupRef.current = cleanup
      }}
    />
  )
}

function currentSavedStampsFrameHeight(frame: HTMLElement): number {
  const styledHeight = Number.parseFloat(frame.style.height)
  if (Number.isFinite(styledHeight)) return styledHeight

  const measuredHeight = frame.getBoundingClientRect().height
  if (Number.isFinite(measuredHeight) && measuredHeight > 0) return measuredHeight

  return savedStampsFrameHeight.value
}

function resolveSavedStampsFrameHeight(
  height: number,
  container: HTMLElement | null,
): number {
  const roundedHeight = Number.isFinite(height)
    ? Math.round(height)
    : savedStampsFrameHeight.value
  const containerHeight = container?.getBoundingClientRect().height ?? 0
  const maxHeight = Number.isFinite(containerHeight) && containerHeight > MIN_FAVORITES_FRAME_HEIGHT * 2
    ? Math.max(MIN_FAVORITES_FRAME_HEIGHT, Math.round(containerHeight - MIN_FAVORITES_FRAME_HEIGHT))
    : Number.POSITIVE_INFINITY

  return Math.max(MIN_FAVORITES_FRAME_HEIGHT, Math.min(maxHeight, roundedHeight))
}

function clearPreviewTimer(ref: { current: ReturnType<typeof globalThis.setTimeout> | null }): void {
  if (ref.current === null) return
  globalThis.clearTimeout(ref.current)
  ref.current = null
}

function SavedStampRecognitionOverlay({
  preview,
  panelRef,
}: {
  preview: SavedStampPreview | null
  panelRef: { current: HTMLElement | null }
}) {
  if (!preview) return null
  const position = savedStampPreviewPosition(preview.anchorRect, panelRef.current)

  return (
    <div
      className={styles.savedStampThumbnailOverlay}
      data-saved-stamp-thumbnail-overlay
      aria-hidden="true"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${SAVED_OBJECT_STAMP_THUMBNAIL_WIDTH}px`,
        height: `${SAVED_OBJECT_STAMP_THUMBNAIL_HEIGHT}px`,
      }}
    >
      <SavedStampThumbnailSvg stamp={preview.stamp} />
    </div>
  )
}

function savedStampPreviewPosition(anchorRect: DOMRect, panel: HTMLElement | null): { left: number, top: number } {
  const panelRect = panel?.getBoundingClientRect()
  const desiredLeft = (panelRect?.left ?? anchorRect.left) - SAVED_OBJECT_STAMP_THUMBNAIL_WIDTH - SAVED_STAMP_PREVIEW_GAP
  const maxLeft = Math.max(SAVED_STAMP_PREVIEW_MARGIN, window.innerWidth - SAVED_OBJECT_STAMP_THUMBNAIL_WIDTH - SAVED_STAMP_PREVIEW_MARGIN)
  const maxTop = Math.max(SAVED_STAMP_PREVIEW_MARGIN, window.innerHeight - SAVED_OBJECT_STAMP_THUMBNAIL_HEIGHT - SAVED_STAMP_PREVIEW_MARGIN)

  return {
    left: Math.round(Math.min(maxLeft, Math.max(SAVED_STAMP_PREVIEW_MARGIN, desiredLeft))),
    top: Math.round(Math.min(maxTop, Math.max(SAVED_STAMP_PREVIEW_MARGIN, anchorRect.top))),
  }
}

function SavedStampThumbnailSvg({ stamp }: { stamp: SavedObjectStamp }) {
  const signature = createSavedObjectStampThumbnailSignature(stamp.payload_json)
  if (signature.fallback) {
    return (
      <svg className={styles.savedStampThumbnailSvg} viewBox={`0 0 ${signature.width} ${signature.height}`} aria-hidden="true">
        <path className={styles.savedStampThumbnailFallback} d="M54 76h72M90 40v72" />
      </svg>
    )
  }

  return (
    <svg className={styles.savedStampThumbnailSvg} viewBox={`0 0 ${signature.width} ${signature.height}`} aria-hidden="true">
      {signature.zones.map((zone, index) => {
        const points = zone.points.map((point) => `${point.x},${point.y}`).join(' ')
        const ZoneElement = zone.closed ? 'polygon' : 'polyline'
        return (
          <ZoneElement
            key={`zone-${index}`}
            className={styles.savedStampThumbnailZone}
            points={points}
            style={zone.fillColor ? { fill: zone.fillColor } : undefined}
          />
        )
      })}
      {signature.plants.map((plant, index) => (
        <g key={`plant-${index}`}>
          {plant.cluster && (
            <circle
              className={styles.savedStampThumbnailPlantCluster}
              cx={plant.x}
              cy={plant.y}
              r={plant.radius + 2}
            />
          )}
          <circle
            className={styles.savedStampThumbnailPlant}
            cx={plant.x}
            cy={plant.y}
            r={plant.radius}
            style={plant.color ? { fill: plant.color } : undefined}
          />
        </g>
      ))}
      {signature.annotations.map((annotation, index) => (
        <path
          key={`annotation-${index}`}
          className={styles.savedStampThumbnailAnnotation}
          d={`M${annotation.x1} ${annotation.y1}L${annotation.x2} ${annotation.y2}`}
        />
      ))}
    </svg>
  )
}

function SavedObjectStampRow({
  stamp,
  stamps,
  onPreviewRequest,
  onPreviewSchedule,
  onPreviewClear,
}: {
  stamp: SavedObjectStamp
  stamps: readonly SavedObjectStamp[]
  onPreviewRequest: (stamp: SavedObjectStamp, anchor: HTMLElement) => void
  onPreviewSchedule: (stamp: SavedObjectStamp, anchor: HTMLElement) => void
  onPreviewClear: () => void
}) {
  const [draftName, setDraftName] = useState(stamp.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    setDraftName(stamp.name)
  }, [stamp.name])

  function commitRename(): void {
    const next = draftName.trim()
    if (next.length === 0) {
      setDraftName(stamp.name)
      setIsRenaming(false)
      return
    }
    if (next !== stamp.name) {
      void savedObjectStampWorkbench.renameStamp(stamp.id, next)
    }
    setIsRenaming(false)
  }

  function cancelRename(): void {
    setDraftName(stamp.name)
    setIsRenaming(false)
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
        <SixDotGripIcon />
      </button>
      <div
        className={styles.savedStampContent}
        data-saved-stamp-body={stamp.id}
        draggable={!isRenaming && !confirmingDelete}
        onDragStart={handleStampDragStart}
        onDragEnd={handleStampDragEnd}
        tabIndex={confirmingDelete ? -1 : 0}
        onPointerEnter={(event) => {
          if (isRenaming || confirmingDelete) return
          onPreviewSchedule(stamp, event.currentTarget as HTMLElement)
        }}
        onPointerLeave={onPreviewClear}
        onFocus={(event) => {
          if (isRenaming || confirmingDelete) return
          onPreviewRequest(stamp, event.currentTarget as HTMLElement)
        }}
        onBlur={onPreviewClear}
      >
        {confirmingDelete ? (
          <span className={styles.savedStampDeleteCopy}>{t('savedObjectStamps.confirmDelete')}</span>
        ) : isRenaming ? (
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
                cancelRename()
                ;(event.currentTarget as HTMLInputElement).blur()
              }
            }}
          />
        ) : (
          <span className={styles.savedStampName}>{stamp.name}</span>
        )}
        {!confirmingDelete && <span className={styles.savedStampSummary}>{savedStampSummary(stamp)}</span>}
      </div>
      <div className={styles.savedStampActions}>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className={styles.savedStampDangerButton}
              aria-label={t('savedObjectStamps.confirmDelete')}
              onClick={() => void savedObjectStampWorkbench.deleteStamp(stamp.id)}
            >
              {t('savedObjectStamps.confirmDelete')}
            </button>
            <button
              type="button"
              className={styles.savedStampSecondaryButton}
              aria-label={t('canvas.plantSpacing.cancel')}
              onClick={() => setConfirmingDelete(false)}
            >
              {t('canvas.plantSpacing.cancel')}
            </button>
          </>
        ) : (
          <>
            <SavedStampIconButton
              label={t('savedObjectStamps.place')}
              onClick={() => savedObjectStampWorkbench.placeStamp(stamp)}
              onFocus={(anchor) => onPreviewRequest(stamp, anchor)}
              onBlur={onPreviewClear}
            >
              <PlaceIcon />
            </SavedStampIconButton>
            <SavedStampIconButton
              label={t('savedObjectStamps.export')}
              onClick={() => void savedObjectStampWorkbench.exportStamp(stamp)}
            >
              <ExportIcon />
            </SavedStampIconButton>
            {isRenaming ? (
              <>
                <SavedStampIconButton
                  label={t('canvas.plantSpacing.confirm')}
                  onClick={commitRename}
                >
                  <CheckIcon />
                </SavedStampIconButton>
                <SavedStampIconButton
                  label={t('canvas.plantSpacing.cancel')}
                  onClick={cancelRename}
                >
                  <CancelIcon />
                </SavedStampIconButton>
              </>
            ) : (
              <>
                <SavedStampIconButton
                  label={t('savedObjectStamps.renameLabel')}
                  onClick={() => {
                    setConfirmingDelete(false)
                    setDraftName(stamp.name)
                    setIsRenaming(true)
                  }}
                >
                  <PencilIcon />
                </SavedStampIconButton>
                <SavedStampIconButton
                  label={t('savedObjectStamps.delete')}
                  onClick={() => {
                    setIsRenaming(false)
                    setConfirmingDelete(true)
                  }}
                  danger
                >
                  <TrashIcon />
                </SavedStampIconButton>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SavedStampIconButton({
  label,
  onClick,
  children,
  danger = false,
  onFocus,
  onBlur,
}: {
  label: string
  onClick: () => void
  children: ComponentChildren
  danger?: boolean
  onFocus?: (anchor: HTMLElement) => void
  onBlur?: () => void
}) {
  return (
    <button
      type="button"
      className={`${styles.savedStampIconButton} ${danger ? styles.savedStampIconButtonDanger : ''}`}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onFocus={(event) => onFocus?.(event.currentTarget)}
      onBlur={onBlur}
    >
      {children}
      <ButtonTooltip label={label} side="left" />
    </button>
  )
}

function SixDotGripIcon() {
  return (
    <span className={styles.savedStampGripDots} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  )
}

function PlaceIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V3" />
      <path d="M5.5 5.5 8 3l2.5 2.5" />
      <path d="M4 9.5v2.5h8V9.5" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.5 3 13l1.5-.5 7-7L10.5 4.5l-7 7Z" />
      <path d="m9.5 5.5 1 1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  )
}

function CancelIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 4.5 7 7" />
      <path d="m11.5 4.5-7 7" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className={styles.savedStampActionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M5 6.5v6h6v-6" />
    </svg>
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
