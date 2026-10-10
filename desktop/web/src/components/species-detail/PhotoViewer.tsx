import { useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { ControlIcon } from '../shared/ControlIcon'
import row from '../shared/species-row.module.css'
import type { SpeciesPhoto } from './photo-attribution'
import { formatNumber } from './species-facts'
import styles from './SpeciesDetail.module.css'

/** What the viewer shows and how it moves; each edition supplies its own loading. */
export interface PhotoViewerModel {
  readonly photos: readonly SpeciesPhoto[]
  /** The photo list itself is still loading. */
  readonly loading: boolean
  readonly index: number
  readonly src: string | null
  readonly ready: boolean
  readonly failed: boolean
  select(index: number): void
  next(): void
  prev(): void
  loaded(): void
  errored(): void
}

/**
 * Species photos: a 3:2 frame with a shimmer while loading, arrows and dots when there are
 * several (Left, Right, Home and End move between them), and the source and license under
 * the photo. A species without photos keeps a quiet placeholder.
 */
export function PhotoViewer({ model, name, linkSources }: {
  readonly model: PhotoViewerModel
  readonly name: string
  /** Link the source page (Web); Desktop shows the source as text. */
  readonly linkSources: boolean
}) {
  const { photos, index } = model
  const current = photos[index]

  if (model.loading) {
    return (
      <div className={styles.photoFrame} aria-busy="true">
        <span className={styles.shimmer} />
        <span className={row.srOnly}>{t('plantDetail.photosLoading')}</span>
      </div>
    )
  }

  if (!current) {
    return (
      <div className={styles.noPhoto}>
        <span className={styles.noPhotoTile} aria-hidden="true"><ControlIcon name="image" size={20} /></span>
        <span>{t('plantDetail.noPhotos')}</span>
      </div>
    )
  }

  const count = photos.length
  const position = (at: number) => t('plantDetail.photoLabel', {
    current: formatNumber(at + 1, locale.value, 0),
    total: formatNumber(count, locale.value, 0),
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (count < 2) return
    const moves: Record<string, () => void> = {
      ArrowLeft: () => model.prev(),
      ArrowRight: () => model.next(),
      Home: () => model.select(0),
      End: () => model.select(count - 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  return (
    // The carousel owns its arrows, Shift+arrows included, so they never turn the map (spec §1.6).
    <section className={styles.photos} aria-roledescription={t('plantDetail.carousel')} aria-label={t('plantDetail.photos')} data-owns-keys="arrows" onKeyDown={onKeyDown}>
      <div className={styles.photoFrame}>
        {model.src !== null && !model.failed && (
          <img
            key={model.src}
            src={model.src}
            alt={t('plantDetail.photoAlt', { name })}
            className={`${styles.photo} ${model.ready ? styles.photoReady : ''}`}
            loading="lazy"
            data-testid="species-photo"
            onLoad={() => model.loaded()}
            onError={() => model.errored()}
          />
        )}
        {!model.ready && !model.failed && <span className={styles.shimmer} aria-hidden="true" />}
        {model.failed && (
          <span className={styles.photoFailed}>
            <ControlIcon name="image" size={20} />
            {t('plantDetail.photoFailed')}
          </span>
        )}
        {count > 1 && (
          <>
            <button type="button" className={`${styles.photoNav} ${styles.photoPrev}`} aria-label={t('plantDetail.photoPrev')} onClick={() => model.prev()}>
              <ControlIcon name="chevron-left" size={18} />
              <ButtonTooltip label={t('plantDetail.photoPrev')} side="right" />
            </button>
            <button type="button" className={`${styles.photoNav} ${styles.photoNext}`} aria-label={t('plantDetail.photoNext')} onClick={() => model.next()}>
              <ControlIcon name="chevron-right" size={18} />
              <ButtonTooltip label={t('plantDetail.photoNext')} side="left" />
            </button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className={styles.photoDots}>
          {photos.map((photo, at) => (
            <button
              key={photo.url}
              type="button"
              className={styles.photoDot}
              aria-label={position(at)}
              aria-current={at === index ? 'true' : undefined}
              onClick={() => model.select(at)}
            />
          ))}
          <span className={styles.photoCount} aria-live="polite">{position(index)}</span>
        </div>
      )}
      <PhotoAttribution photo={current} linkSources={linkSources} />
    </section>
  )
}

function PhotoAttribution({ photo, linkSources }: { readonly photo: SpeciesPhoto; readonly linkSources: boolean }) {
  const source = photo.source ?? t('plantDetail.sourceNotRecorded')
  return (
    <p className={styles.attribution} data-testid="species-photo-attribution">
      {t('plantDetail.photoCredit')}{' '}
      {photo.credit && <>{photo.credit} · </>}
      {linkSources && photo.sourcePageUrl
        ? <a href={photo.sourcePageUrl} target="_blank" rel="noopener noreferrer">{source}</a>
        : source}
      {' · '}
      {photo.license ?? t('plantDetail.licenseNotRecorded')}
    </p>
  )
}

/**
 * A viewer model over photos whose addresses are known up front (the Web hero image).
 * A new list resets the viewer during render, not in a deferred effect: a cached image can
 * fire `load` before effects run, and a late reset would hide it behind the shimmer.
 */
export function usePhotoList(photos: readonly SpeciesPhoto[]): PhotoViewerModel {
  const identity = photos.map(photo => photo.url).join('\n')
  const generation = useRef({ identity, value: 0 })
  if (generation.current.identity !== identity) {
    generation.current = { identity, value: generation.current.value + 1 }
  }
  const current = generation.current.value
  const [view, setView] = useState<PhotoListView>(() => freshView(current))
  const shown = view.generation === current ? view : freshView(current)
  const { index, ready, failed } = shown
  const update = (change: Partial<PhotoListView>) =>
    setView(previous => ({ ...(previous.generation === current ? previous : freshView(current)), ...change }))
  const select = (next: number) => {
    if (next < 0 || next >= photos.length || next === index) return
    update({ index: next, ready: false, failed: false })
  }
  const count = photos.length
  return {
    photos,
    loading: false,
    index,
    src: photos[index]?.url ?? null,
    ready,
    failed,
    select,
    next: () => select(count > 1 ? (index + 1) % count : index),
    prev: () => select(count > 1 ? (index - 1 + count) % count : index),
    loaded: () => update({ ready: true }),
    errored: () => update({ failed: true }),
  }
}

interface PhotoListView {
  readonly generation: number
  readonly index: number
  readonly ready: boolean
  readonly failed: boolean
}

function freshView(generation: number): PhotoListView {
  return { generation, index: 0, ready: false, failed: false }
}
