import { useRef, useEffect, useReducer } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
} from '@tanstack/virtual-core';
import { t } from '../../i18n';
import { locale } from '../../state/app';
import {
  searchResults,
  isSearching,
  searchError,
  nextCursor,
  viewMode,
  loadNextPage,
  searchText,
  hasActiveFilters,
  retrySearch,
} from '../../state/plant-db';
import { PlantRow } from './PlantRow';
import { PlantCard } from './PlantCard';
import styles from './PlantDb.module.css';

// Force a re-render (used as Virtualizer.onChange callback)
function useForceUpdate(): () => void {
  const [, dispatch] = useReducer((n: number) => n + 1, 0);
  return dispatch as () => void;
}

const ESTIMATED_ROW_HEIGHT = 72;

// Helper: build Virtualizer options object
function makeVirtOpts(
  scrollRef: { current: HTMLDivElement | null },
  count: number,
  onChange: (instance: Virtualizer<HTMLDivElement, Element>) => void,
) {
  return {
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange,
  };
}

export function ResultsList() {
  void locale.value;
  const results = searchResults.value;
  const searching = isSearching.value;
  const error = searchError.value;
  const hasMore = nextCursor.value !== null;
  const mode = viewMode.value;

  const scrollRef = useRef<HTMLDivElement>(null);
  const forceUpdate = useForceUpdate();
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);

  // Create/destroy Virtualizer when entering/leaving list mode
  useEffect(() => {
    if (mode !== 'list') {
      // Cleanup if switching away from list
      if (virtualizerRef.current) {
        const cleanup = virtualizerRef.current._didMount();
        cleanup?.();
        virtualizerRef.current = null;
      }
      return;
    }

    const handleChange = (instance: Virtualizer<HTMLDivElement, Element>) => {
      virtualizerRef.current = instance;
      forceUpdate();
    };

    const virt = new Virtualizer<HTMLDivElement, Element>(
      makeVirtOpts(scrollRef, searchResults.value.length, handleChange),
    );

    virtualizerRef.current = virt;
    const cleanup = virt._didMount();
    virt._willUpdate();

    return () => {
      cleanup?.();
      virtualizerRef.current = null;
    };
  // forceUpdate is stable (reducer dispatch), mode drives create/destroy
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Keep Virtualizer count in sync with searchResults signal changes
  useSignalEffect(() => {
    const count = searchResults.value.length;
    const virt = virtualizerRef.current;
    if (!virt) return;
    virt.setOptions(
      makeVirtOpts(scrollRef, count, (instance) => {
        virtualizerRef.current = instance;
        forceUpdate();
      }),
    );
    virt._willUpdate();
  });

  // Infinite scroll: load next page when near the bottom
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || isSearching.value || nextCursor.value === null) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void loadNextPage();
    }
  };

  // Loading state (initial, no results yet)
  if (searching && results.length === 0) {
    return (
      <div className={styles.listContainer}>
        <div className={styles.listLoader} aria-live="polite" aria-busy="true">
          {t('plantDb.loading')}
        </div>
      </div>
    );
  }

  // Error state
  if (error !== null && results.length === 0) {
    return (
      <div className={styles.listContainer}>
        <div className={styles.listError} role="alert">
          <span>{t('plantDb.error')}: {error}</span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              // Trigger re-search by nudging the sort signal (safe side-effect)
              const s = searchText.value;
              searchText.value = s;
            }}
          >
            {t('plantDb.retry')}
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!searching && results.length === 0) {
    const hasQuery = searchText.value.length > 0 || hasActiveFilters.value;
    return (
      <div className={styles.listContainer}>
        <div className={styles.listEmpty}>
          {hasQuery ? (
            <p className={styles.listEmptyText}>{t('plantDb.noResults')}</p>
          ) : (
            <>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.4, marginBottom: '8px' }}>
                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" />
                <path d="M32 32L44 44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 12C15.6 12 12 15.6 12 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              </svg>
              <p className={styles.listEmptyText} style={{ fontWeight: 500 }}>
                {t('plantDb.searchPlaceholder')}
              </p>
              <p className={styles.listEmptyText} style={{ fontSize: 'var(--text-xs)', marginTop: '4px' }}>
                {t('plantDb.emptyHint')}
              </p>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => retrySearch()}
                style={{ marginTop: '12px' }}
              >
                {t('plantDb.loadPlants')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Card / grid view
  if (mode === 'card') {
    return (
      <div
        ref={scrollRef}
        className={styles.listContainer}
        onScroll={handleScroll}
      >
        <div className={styles.cardGrid} role="list" aria-label={t('plantDb.title')}>
          {results.map((plant) => (
            <PlantCard key={plant.canonical_name} plant={plant} />
          ))}
        </div>
        {searching && (
          <div className={styles.listLoader} aria-live="polite" aria-busy="true">
            {t('plantDb.loadingMore')}
          </div>
        )}
      </div>
    );
  }

  // List view — virtual scroll
  const virt = virtualizerRef.current;
  const virtualItems = virt?.getVirtualItems() ?? [];
  const totalSize = virt?.getTotalSize() ?? results.length * ESTIMATED_ROW_HEIGHT;

  return (
    <div
      ref={scrollRef}
      className={styles.listContainer}
      onScroll={handleScroll}
    >
      <div
        className={styles.listInner}
        style={{ height: `${totalSize}px` }}
        role="list"
        aria-label={t('plantDb.title')}
        aria-rowcount={results.length}
      >
        {virtualItems.map((virtualRow) => {
          const plant = results[virtualRow.index];
          if (!plant) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <PlantRow plant={plant} />
            </div>
          );
        })}
      </div>

      {(searching || hasMore) && (
        <div className={styles.listLoader} aria-live="polite" aria-busy={searching}>
          {searching ? t('plantDb.loadingMore') : ''}
        </div>
      )}
    </div>
  );
}
