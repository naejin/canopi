import { useState } from 'preact/hooks'
import { convertFileSrc } from '@tauri-apps/api/core'
import { t } from '../../../i18n'
import {
  lidarLibrary,
  openImportJob,
  readLidarPresentation,
  type LidarPresentationItem,
} from '../../../app/lidar/library-store'
import {
  analyseLayerAsSlope,
  applyOpenImport,
  cancelOpenImport,
  createLidarLayer,
  deleteLidarAnalysis,
  deleteLidarLayer,
  setLidarEntryOpacity,
  setLidarEntryVisibility,
  startImportForLayer,
} from '../../../app/lidar/actions'
import { currentDesign } from '../../../app/document-session/store'
import styles from './lidar-layers-section.module.css'

/**
 * LiDAR band section of the Layers dock: source layers in presentation order
 * with their analysis results indented below, plus the import review surface.
 * Visibility, opacity and order live in the open Design; library mutations
 * never dirty the document by themselves.
 */
export function LidarLayersSection() {
  const library = lidarLibrary.value
  const items = readLidarPresentation(currentDesign.value, library)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const engineUnavailable = library !== null && !library.engine.available
  const sources = items.filter((item) => item.kind === 'Source')
  const analysesById = new Map(
    items.filter((item) => item.kind === 'Analysis').map((item) => [item.id, item]),
  )

  const submitCreate = (): void => {
    const name = newName.trim()
    if (name.length === 0) {
      return
    }
    setCreating(false)
    setNewName('')
    void createLidarLayer(name, 'GroundElevation')
  }

  return (
    <section className={styles.section} aria-label={t('canvas.lidar.section')}>
      <div className={styles.groupHeading}>
        <h3>{t('canvas.lidar.section')}</h3>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? t('canvas.lidar.cancelCreate') : t('canvas.lidar.addLayer')}
        </button>
      </div>
      {engineUnavailable && (
        <p className={styles.engineWarning}>{t('canvas.lidar.engineUnavailable')}</p>
      )}
      {creating && (
        <div className={styles.createForm}>
          <input
            className={styles.nameInput}
            value={newName}
            placeholder={t('canvas.lidar.layerNamePlaceholder')}
            onChange={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCreate()
            }}
          />
          <button type="button" className={styles.createButton} onClick={submitCreate}>
            {t('canvas.lidar.createLayer')}
          </button>
        </div>
      )}
      <div role="list">
        {sources.map((item) => {
          const results = (library?.analyses ?? [])
            .filter((analysis) => analysis.source_layer_id === item.id)
            .flatMap((analysis) => {
              const presented = analysesById.get(analysis.id)
              return presented ? [presented] : []
            })
          return <LidarSourceRow key={item.id} item={item} results={results} />
        })}
        {sources.length === 0 && (
          <p className={styles.emptyHint}>{t('canvas.lidar.empty')}</p>
        )}
      </div>
      <LidarImportReviewBlock />
    </section>
  )
}

function LidarSourceRow({
  item,
  results,
}: {
  readonly item: LidarPresentationItem
  readonly results: readonly LidarPresentationItem[]
}) {
  const [impactText, setImpactText] = useState<string | null>(null)
  const library = lidarLibrary.value
  const layer = library?.layers.find((candidate) => candidate.id === item.id)
  const referencedCount = countDesignReferences(item.id)

  const armDelete = (): void => {
    const analysisCount = library?.analyses.filter(
      (analysis) => analysis.source_layer_id === item.id,
    ).length ?? 0
    const parts = [t('canvas.lidar.deleteLayerImpact', { analyses: analysisCount })]
    if (referencedCount > 0) {
      parts.push(t('canvas.lidar.deleteReferenceImpact', { references: referencedCount }))
    }
    setImpactText(parts.join(' '))
  }

  return (
    <div className={styles.sourceBlock} role="listitem">
      <div className={styles.row}>
        <EyeToggle item={item} />
        <span className={styles.name} title={item.name}>{item.name}</span>
        <span className={styles.chip}>
          {t(`canvas.lidar.kind.${layer?.measurement_kind ?? item.detail}`)}
        </span>
        <StateChip state={item.state} />
        <button
          type="button"
          className={styles.action}
          onClick={() => void startImportForLayer(item.id)}
        >
          {t('canvas.lidar.addTiffs')}
        </button>
        {layer?.measurement_kind === 'GroundElevation' && (
          <button
            type="button"
            className={styles.action}
            onClick={() => void analyseLayerAsSlope(item.id)}
          >
            {t('canvas.lidar.analyse')}
          </button>
        )}
        {impactText === null ? (
          <button type="button" className={styles.action} onClick={armDelete}>
            {t('canvas.lidar.delete')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.destructive}
            title={impactText}
            onClick={() => {
              setImpactText(null)
              void deleteLidarLayer(item.id)
            }}
          >
            {t('canvas.lidar.confirmDelete')}
          </button>
        )}
      </div>
      <OpacitySlider item={item} />
      {results.map((result) => (
        <LidarAnalysisRow key={result.id} item={result} />
      ))}
    </div>
  )
}

function LidarAnalysisRow({ item }: { readonly item: LidarPresentationItem }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className={styles.analysisRow} role="listitem">
      <EyeToggle item={item} />
      <span className={styles.name} title={item.name}>{item.name}</span>
      <StateChip state={item.state} />
      <label className={styles.opacityInline}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={item.opacity}
          aria-label={t('canvas.lidar.opacity')}
          onChange={(event) => setLidarEntryOpacity(item.id, Number(event.currentTarget.value))}
        />
      </label>
      {confirmDelete ? (
        <button
          type="button"
          className={styles.destructive}
          onClick={() => {
            setConfirmDelete(false)
            void deleteLidarAnalysis(item.id)
          }}
        >
          {t('canvas.lidar.confirmDelete')}
        </button>
      ) : (
        <button type="button" className={styles.action} onClick={() => setConfirmDelete(true)}>
          {t('canvas.lidar.delete')}
        </button>
      )}
    </div>
  )
}

function EyeToggle({ item }: { readonly item: LidarPresentationItem }) {
  return (
    <button
      type="button"
      className={styles.eyeButton}
      aria-pressed={item.visible}
      title={item.visible ? t('canvas.lidar.hide') : t('canvas.lidar.show')}
      onClick={() => setLidarEntryVisibility(item.id, !item.visible)}
    >
      {item.visible ? '◉' : '○'}
    </button>
  )
}

function StateChip({ state }: { readonly state: LidarPresentationItem['state'] }) {
  const className = state in styles ? (styles as Record<string, string>)[state] : styles.Ready
  return <span className={`${styles.chip} ${className}`}>{t(`canvas.lidar.state.${state}`)}</span>
}

function OpacitySlider({ item }: { readonly item: LidarPresentationItem }) {
  return (
    <label className={styles.opacityRow}>
      <span>{t('canvas.lidar.opacity')}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={item.opacity}
        onChange={(event) => setLidarEntryOpacity(item.id, Number(event.currentTarget.value))}
      />
    </label>
  )
}

function countDesignReferences(entityId: string): number {
  const entries = currentDesign.value?.lidar?.entries ?? []
  return entries.filter((entry) => entry.id === entityId).length
}

function LidarImportReviewBlock() {
  const job = openImportJob.value
  const [addUncovered, setAddUncovered] = useState(true)
  const [replaceOverlap, setReplaceOverlap] = useState(false)

  if (job === null || job.state !== 'AwaitingReview' || job.review == null) {
    return null
  }
  const review = job.review
  const beforeUrl = review.before_preview_path
    ? convertFileSrc(review.before_preview_path)
    : null
  const afterUrl = review.after_preview_path
    ? convertFileSrc(review.after_preview_path)
    : null

  return (
    <div className={styles.review}>
      <h4>{t('canvas.lidar.review.title')}</h4>
      <ul className={styles.reviewSources}>
        {review.sources.map((source) => (
          <li key={source.sha256}>
            {source.filename}
            {source.issues.length > 0 && (
              <span className={styles.issueList}>{source.issues.join(' · ')}</span>
            )}
          </li>
        ))}
      </ul>
      <dl className={styles.reviewCounts}>
        <div><dt>{t('canvas.lidar.review.uncovered')}</dt><dd>{Number(review.uncovered_cells).toLocaleString()}</dd></div>
        <div><dt>{t('canvas.lidar.review.overlap')}</dt><dd>{Number(review.overlap_cells).toLocaleString()}</dd></div>
        <div><dt>{t('canvas.lidar.review.invalid')}</dt><dd>{Number(review.invalid_cells).toLocaleString()}</dd></div>
      </dl>
      <div className={styles.previews}>
        {beforeUrl !== null && (
          <figure>
            <img src={beforeUrl} alt={t('canvas.lidar.review.before')} />
            <figcaption>{t('canvas.lidar.review.before')}</figcaption>
          </figure>
        )}
        {afterUrl !== null && (
          <figure>
            <img src={afterUrl} alt={t('canvas.lidar.review.after')} />
            <figcaption>{t('canvas.lidar.review.after')}</figcaption>
          </figure>
        )}
      </div>
      <label className={styles.decision}>
        <input
          type="checkbox"
          checked={addUncovered}
          onChange={(event) => setAddUncovered(event.currentTarget.checked)}
        />
        {t('canvas.lidar.review.addUncovered')}
      </label>
      <label className={styles.decision}>
        <input
          type="checkbox"
          checked={replaceOverlap}
          onChange={(event) => setReplaceOverlap(event.currentTarget.checked)}
        />
        {t('canvas.lidar.review.replaceOverlap')}
      </label>
      <div className={styles.reviewActions}>
        <button
          type="button"
          className={styles.applyButton}
          disabled={!addUncovered && !replaceOverlap}
          onClick={() => void applyOpenImport(addUncovered, replaceOverlap)}
        >
          {t('canvas.lidar.review.apply')}
        </button>
        <button type="button" className={styles.action} onClick={() => void cancelOpenImport()}>
          {t('canvas.lidar.review.cancel')}
        </button>
      </div>
    </div>
  )
}
