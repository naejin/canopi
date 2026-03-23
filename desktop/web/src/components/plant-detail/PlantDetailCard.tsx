import { useSignal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import { t } from '../../i18n';
import { locale } from '../../state/app';
import {
  selectedCanonicalName,
  favoriteNames,
  toggleFavoriteAction,
} from '../../state/plant-db';
import { getSpeciesDetail } from '../../ipc/species';
import type { SpeciesDetail } from '../../types/species';
import { AttributeGrid } from './AttributeGrid';
import { UsesSection } from './UsesSection';
import { RelationshipList } from './RelationshipList';
import styles from './PlantDetail.module.css';

interface Props {
  canonicalName: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

export function PlantDetailCard({ canonicalName }: Props) {
  void locale.value;

  const detail = useSignal<SpeciesDetail | null>(null);
  const loadState = useSignal<LoadState>('loading');
  const errorMsg = useSignal<string | null>(null);

  // Reload whenever the selected species or locale changes.
  // Read selectedCanonicalName signal directly so the effect re-runs
  // when clicking related species (prop alone won't trigger useSignalEffect).
  useSignalEffect(() => {
    const name = selectedCanonicalName.value ?? canonicalName;
    const loc = locale.value;

    // Reset on new fetch
    detail.value = null;
    loadState.value = 'loading';
    errorMsg.value = null;

    let cancelled = false;

    getSpeciesDetail(name, loc)
      .then((data) => {
        if (cancelled) return;
        detail.value = data;
        loadState.value = 'loaded';
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        errorMsg.value = err instanceof Error ? err.message : String(err);
        loadState.value = 'error';
      });

    return () => {
      cancelled = true;
    };
  });

  const isFavorite = favoriteNames.value.includes(canonicalName);

  const handleBack = () => {
    selectedCanonicalName.value = null;
  };

  const handleFav = () => {
    void toggleFavoriteAction(canonicalName);
  };

  const handleRetry = () => {
    // Nudge loadState to re-trigger the effect by re-assigning locale (safe),
    // but simpler: just re-invoke directly.
    detail.value = null;
    loadState.value = 'loading';
    errorMsg.value = null;

    getSpeciesDetail(canonicalName, locale.value)
      .then((data) => {
        detail.value = data;
        loadState.value = 'loaded';
      })
      .catch((err: unknown) => {
        errorMsg.value = err instanceof Error ? err.message : String(err);
        loadState.value = 'error';
      });
  };

  const favLabel = isFavorite
    ? t('plantDb.removeFavorite')
    : t('plantDb.addFavorite');

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadState.value === 'loading') {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={handleBack}
            aria-label={t('plantDetail.back')}
            title={t('plantDetail.back')}
          >
            ‹
          </button>
          <div className={styles.headerInfo}>
            <span className={styles.botanicalName}>{canonicalName}</span>
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.loadingState} aria-live="polite" aria-busy="true">
            {t('plantDetail.loading')}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (loadState.value === 'error') {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={handleBack}
            aria-label={t('plantDetail.back')}
            title={t('plantDetail.back')}
          >
            ‹
          </button>
          <div className={styles.headerInfo}>
            <span className={styles.botanicalName}>{canonicalName}</span>
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.errorState} role="alert">
            <span>{t('plantDetail.error')}: {errorMsg.value}</span>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={handleRetry}
            >
              {t('plantDetail.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────────────
  const d = detail.value!;

  const soilTypesStr = d.soil_types.length > 0 ? d.soil_types.join(', ') : t('plantDetail.unknown');
  const phStr =
    d.soil_ph_min !== null && d.soil_ph_max !== null
      ? `${d.soil_ph_min}–${d.soil_ph_max}`
      : d.soil_ph_min !== null
        ? `${d.soil_ph_min}+`
        : t('plantDetail.unknown');

  return (
    <div className={styles.card}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleBack}
          aria-label={t('plantDetail.back')}
          title={t('plantDetail.back')}
        >
          ‹
        </button>

        <div className={styles.headerInfo}>
          <span className={styles.botanicalName}>{d.canonical_name}</span>
          {d.common_name !== null && (
            <span className={styles.commonName}>{d.common_name}</span>
          )}
          <span className={styles.taxonomy}>
            {d.family}
            {' · '}
            {d.genus}
          </span>
        </div>

        <button
          type="button"
          className={`${styles.favBtn} ${isFavorite ? styles.favBtnActive : ''}`}
          onClick={handleFav}
          aria-label={favLabel}
          aria-pressed={isFavorite}
          title={favLabel}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className={styles.body}>

        {/* DIMENSIONS */}
        <section className={`${styles.section} ${styles.sectionDimensions}`} aria-label={t('plantDetail.dimensions')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>↕</span> {t('plantDetail.dimensions')}
          </h3>
          <div className={styles.sectionBody}>
            <AttributeGrid detail={d} />
          </div>
        </section>

        {/* TOLERANCES */}
        <section className={`${styles.section} ${styles.sectionTolerances}`} aria-label={t('plantDetail.tolerances')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>☀</span> {t('plantDetail.tolerances')}
          </h3>
          <div className={styles.sectionBody}>
            {/* Sun chips */}
            <div className={styles.sunRow} aria-label={t('plantDetail.sunTolerance')}>
              <span
                className={`${styles.sunChip} ${d.tolerates_full_sun ? styles.sunChipSun : ''}`}
                aria-label={`${t('plantDetail.fullSun')}: ${d.tolerates_full_sun ? t('plantDetail.yes') : t('plantDetail.no')}`}
              >
                ☀ {t('plantDetail.fullSun')}
              </span>
              <span
                className={`${styles.sunChip} ${d.tolerates_semi_shade ? styles.sunChipShade : ''}`}
                aria-label={`${t('plantDetail.semiShade')}: ${d.tolerates_semi_shade ? t('plantDetail.yes') : t('plantDetail.no')}`}
              >
                ◐ {t('plantDetail.semiShade')}
              </span>
              <span
                className={`${styles.sunChip} ${d.tolerates_full_shade ? styles.sunChipShade : ''}`}
                aria-label={`${t('plantDetail.fullShade')}: ${d.tolerates_full_shade ? t('plantDetail.yes') : t('plantDetail.no')}`}
              >
                ● {t('plantDetail.fullShade')}
              </span>
            </div>

            {/* Tolerances grid */}
            <div className={styles.attrGrid}>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.soilPh')}</span>
                <span className={styles.attrValue}>{phStr}</span>
              </div>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.soilTypes')}</span>
                <span className={styles.attrValue}>{soilTypesStr}</span>
              </div>
            </div>
          </div>
        </section>

        {/* USES */}
        <section className={`${styles.section} ${styles.sectionUses}`} aria-label={t('plantDetail.uses')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>●</span> {t('plantDetail.uses')}
          </h3>
          <UsesSection
            uses={d.uses}
            edibilityRating={d.edibility_rating}
            medicinalRating={d.medicinal_rating}
          />
        </section>

        {/* ECOLOGY */}
        <section className={`${styles.section} ${styles.sectionEcology}`} aria-label={t('plantDetail.ecology')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⟳</span> {t('plantDetail.ecology')}
          </h3>
          <div className={styles.sectionBody}>
            {/* Ecology chips for key indicators */}
            <div className={styles.sunRow}>
              {d.nitrogen_fixation !== null && d.nitrogen_fixation.toLowerCase() !== 'none' && d.nitrogen_fixation.toLowerCase() !== 'no' && (
                <span className={`${styles.ecoChip} ${styles.ecoChipNitrogen}`}>
                  ⚡ N-fixer: {d.nitrogen_fixation}
                </span>
              )}
              {d.stratum !== null && (
                <span className={`${styles.ecoChip} ${styles.ecoChipStratum}`}>
                  {d.stratum}
                </span>
              )}
            </div>

            <div className={styles.attrGrid}>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.nitrogenFixation')}</span>
                <span className={styles.attrValue}>{d.nitrogen_fixation ?? t('plantDetail.unknown')}</span>
              </div>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.stratum')}</span>
                <span className={styles.attrValue}>{d.stratum ?? t('plantDetail.unknown')}</span>
              </div>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.habit')}</span>
                <span className={styles.attrValue}>{d.habit ?? t('plantDetail.unknown')}</span>
              </div>
              <div className={styles.attrItem}>
                <span className={styles.attrLabel}>{t('plantDetail.successionStage')}</span>
                <span className={styles.attrValue}>{d.deciduous_evergreen ?? t('plantDetail.unknown')}</span>
              </div>
            </div>
          </div>
        </section>

        {/* RELATED SPECIES */}
        <section className={`${styles.section} ${styles.sectionRelated}`} aria-label={t('plantDetail.relatedSpecies')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⇄</span>
            {t('plantDetail.relatedSpecies')}
            {d.relationships.length > 0 && ` (${d.relationships.length})`}
          </h3>
          <RelationshipList relationships={d.relationships} />
        </section>

      </div>
    </div>
  );
}
