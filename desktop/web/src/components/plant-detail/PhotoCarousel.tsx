import { useEffect, useMemo } from 'preact/hooks';
import { t } from '../../i18n';
import { createPlantMediaController } from '../../app/plant-detail';
import styles from './PhotoCarousel.module.css';

const IMAGE_SOURCE_DISPLAY: Record<string, string> = {
  wikidata_p18: 'Wikimedia Commons',
  inaturalist: 'iNaturalist',
};

interface Props {
  canonicalName: string;
}

export function PhotoCarousel({ canonicalName }: Props) {
  const media = useMemo(() => createPlantMediaController(), []);

  useEffect(() => {
    media.setCanonicalName(canonicalName);
  }, [canonicalName, media]);

  useEffect(() => () => media.dispose(), [media]);

  const images = media.images.value;
  const currentIndex = media.currentIndex.value;
  const currentImage = images[currentIndex];

  // No images available
  if (!media.loading.value && images.length === 0) {
    return (
      <div className={styles.placeholder}>
        <svg className={styles.placeholderIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  // Still loading image list
  if (media.loading.value) {
    return (
      <div className={styles.imageContainer}>
        <div className={styles.loading} />
      </div>
    );
  }

  return (
    <div
      className={styles.carousel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') media.goPrev();
        else if (event.key === 'ArrowRight') media.goNext();
      }}
      role="region"
      aria-label={t('plantDetail.photos')}
    >
      <div className={styles.imageContainer}>
        {media.loadedSrc.value ? (
          <img
            src={media.loadedSrc.value}
            alt={canonicalName}
            className={`${styles.image} ${media.imageReady.value ? styles.imageLoaded : ''}`}
            loading="lazy"
            onLoad={() => media.markImageLoaded()}
            onError={() => media.handleImageError()}
          />
        ) : media.loadFailed.value ? (
          <div className={styles.inlinePlaceholder}>
            <svg className={styles.placeholderIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        ) : (
          <div className={styles.loading} />
        )}

        {/* Source badge */}
        {currentImage?.source && media.imageReady.value && (
          <span className={styles.sourceBadge}>
            {IMAGE_SOURCE_DISPLAY[currentImage.source] ?? currentImage.source}
          </span>
        )}

        {/* Nav arrows (only if multiple images) */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navPrev}`}
              onClick={() => media.goPrev()}
              aria-label={t('plantDetail.photoPrev')}
            >
              &#x2039;
            </button>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navNext}`}
              onClick={() => media.goNext()}
              aria-label={t('plantDetail.photoNext')}
            >
              &#x203A;
            </button>
          </>
        )}
      </div>

      {/* Dot indicators */}
      {images.length > 1 && (
        <div className={styles.dots} role="tablist">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.dot} ${i === currentIndex ? styles.dotActive : ''}`}
              onClick={() => media.setCurrentIndex(i)}
              role="tab"
              aria-selected={i === currentIndex}
              aria-label={t('plantDetail.photoCount', { current: i + 1, total: images.length })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
