import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '../../i18n';
import { invoke } from '@tauri-apps/api/core';
import { getSpeciesImages } from '../../ipc/species';
import type { SpeciesImage } from '../../types/species';
import styles from './PhotoCarousel.module.css';

interface Props {
  canonicalName: string;
}

export function PhotoCarousel({ canonicalName }: Props) {
  const [images, setImages] = useState<SpeciesImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [loading, setLoading] = useState(true);

  // Track the canonical name that initiated the current image load
  // to guard against stale setState from slow image cache responses
  const activeSpeciesRef = useRef(canonicalName);

  // Fetch image list when species changes
  useEffect(() => {
    activeSpeciesRef.current = canonicalName;
    setImages([]);
    setCurrentIndex(0);
    setLoadedSrc(null);
    setImageReady(false);
    setLoading(true);

    let cancelled = false;

    getSpeciesImages(canonicalName)
      .then((imgs) => {
        if (cancelled) return;
        setImages(imgs);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [canonicalName]);

  // Load current image through cache
  useEffect(() => {
    if (images.length === 0) return;
    const img = images[currentIndex];
    if (!img) return;

    let cancelled = false;
    setLoadedSrc(null);
    setImageReady(false);

    const species = activeSpeciesRef.current;

    invoke<string>('get_cached_image_url', { url: img.url })
      .then((dataUrl) => {
        if (!cancelled && activeSpeciesRef.current === species) {
          setLoadedSrc(dataUrl);
        }
      })
      .catch(() => {
        // Fallback: try loading URL directly
        if (!cancelled && activeSpeciesRef.current === species) {
          setLoadedSrc(img.url);
        }
      });

    return () => { cancelled = true; };
  }, [images, currentIndex]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  }, [goPrev, goNext]);

  // No images available
  if (!loading && images.length === 0) {
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
  if (loading) {
    return (
      <div className={styles.imageContainer}>
        <div className={styles.loading} />
      </div>
    );
  }

  const currentImage = images[currentIndex];

  return (
    <div
      className={styles.carousel}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={t('plantDetail.photos')}
    >
      <div className={styles.imageContainer}>
        {loadedSrc ? (
          <img
            src={loadedSrc}
            alt={canonicalName}
            className={`${styles.image} ${imageReady ? styles.imageLoaded : ''}`}
            loading="lazy"
            onLoad={() => setImageReady(true)}
          />
        ) : (
          <div className={styles.loading} />
        )}

        {/* Source badge */}
        {currentImage?.source && imageReady && (
          <span className={styles.sourceBadge}>
            {currentImage.source}
          </span>
        )}

        {/* Nav arrows (only if multiple images) */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navPrev}`}
              onClick={goPrev}
              aria-label={t('plantDetail.photoPrev')}
            >
              &#x2039;
            </button>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navNext}`}
              onClick={goNext}
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
              onClick={() => setCurrentIndex(i)}
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
