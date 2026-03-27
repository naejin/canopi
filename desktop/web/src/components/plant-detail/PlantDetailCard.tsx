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

// ── Helpers ─────────────────────────────────────────────────────────────────

function BoolChip({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <span className={`${styles.boolChip} ${value ? styles.boolChipTrue : ''}`}>
      {value ? '✓' : '✗'} {label}
    </span>
  );
}

function TextBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className={styles.textItem}>
      <span className={styles.attrLabel}>{label}</span>
      <p className={styles.textContent}>{text}</p>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.attrItem}>
      <span className={styles.attrLabel}>{label}</span>
      <span className={styles.attrValue}>{value}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function PlantDetailCard({ canonicalName }: Props) {
  void locale.value;

  const detail = useSignal<SpeciesDetail | null>(null);
  const loadState = useSignal<LoadState>('loading');
  const errorMsg = useSignal<string | null>(null);
  const expanded = useSignal<Set<string>>(new Set());
  const retryCount = useSignal(0);

  useSignalEffect(() => {
    const name = selectedCanonicalName.value ?? canonicalName;
    const loc = locale.value;
    void retryCount.value;

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

  const effectiveName = selectedCanonicalName.value ?? canonicalName;
  const isFavorite = favoriteNames.value.includes(effectiveName);

  const handleBack = () => {
    selectedCanonicalName.value = null;
  };

  const handleFav = () => {
    void toggleFavoriteAction(effectiveName);
  };

  const handleRetry = () => {
    retryCount.value += 1;
  };

  const toggle = (id: string) => {
    const next = new Set(expanded.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
  };

  const isOpen = (id: string) => expanded.value.has(id);

  const toggleClass = (id: string) =>
    `${styles.sectionTitleToggle} ${isOpen(id) ? styles.sectionTitleToggleOpen : ''}`;

  const favLabel = isFavorite
    ? t('plantDb.removeFavorite')
    : t('plantDb.addFavorite');

  // ── Loading ──────────────────────────────────────────────────────────────
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

  // ── Error ────────────────────────────────────────────────────────────────
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

  // ── Loaded ───────────────────────────────────────────────────────────────
  const d = detail.value!;

  // Section visibility checks
  const hasLifeCycle = d.is_annual !== null || d.is_biennial !== null || d.is_perennial !== null
    || d.lifespan !== null || d.deciduous_evergreen !== null || d.habit !== null
    || d.active_growth_period !== null || d.bloom_period !== null || d.flower_color !== null;

  const hasLight = d.tolerates_full_sun !== null || d.tolerates_semi_shade !== null
    || d.tolerates_full_shade !== null || d.frost_tender !== null || d.drought_tolerance !== null;

  const hasSoil = d.soil_ph_min !== null || d.soil_ph_max !== null
    || d.well_drained !== null || d.heavy_clay !== null || d.tolerates_acid !== null
    || d.tolerates_alkaline !== null || d.tolerates_saline !== null || d.tolerates_wind !== null
    || d.tolerates_pollution !== null || d.tolerates_nutritionally_poor !== null;

  const hasEcology = d.stratum !== null || d.succession_stage !== null || d.nitrogen_fixer !== null
    || d.attracts_wildlife !== null || d.scented !== null;

  const hasUses = d.uses.length > 0 || d.edibility_rating !== null || d.medicinal_rating !== null
    || d.other_uses_rating !== null || d.edible_uses !== null || d.medicinal_uses !== null
    || d.other_uses !== null;

  const hasRisk = d.toxicity !== null || d.known_hazards !== null;

  const hasNotes = d.summary !== null || d.cultivation_notes !== null
    || d.propagation_notes !== null || d.native_range !== null || d.carbon_farming !== null;

  const hasRelated = d.relationships.length > 0;

  const phStr =
    d.soil_ph_min !== null && d.soil_ph_max !== null
      ? `${d.soil_ph_min}–${d.soil_ph_max}`
      : d.soil_ph_min !== null
        ? `${d.soil_ph_min}+`
        : null;

  // Life cycle labels
  const lifeCycleChips: string[] = [];
  if (d.is_annual === true) lifeCycleChips.push(t('plantDetail.annual'));
  if (d.is_biennial === true) lifeCycleChips.push(t('plantDetail.biennial'));
  if (d.is_perennial === true) lifeCycleChips.push(t('plantDetail.perennial'));

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
          {(d.family || d.genus) && (
            <span className={styles.taxonomy}>
              {d.family}{d.family && d.genus ? ' · ' : ''}{d.genus}
            </span>
          )}
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

        {/* DIMENSIONS — always open */}
        <section className={`${styles.section} ${styles.sectionDimensions}`} aria-label={t('plantDetail.dimensions')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>↕</span> {t('plantDetail.dimensions')}
          </h3>
          <div className={styles.sectionBody}>
            <AttributeGrid detail={d} />
          </div>
        </section>

        {/* LIFE CYCLE & FORM */}
        {hasLifeCycle && (
          <section className={`${styles.section} ${styles.sectionLifeCycle}`} aria-label={t('plantDetail.lifeCycle')}>
            <button type="button" className={toggleClass('lifeCycle')} onClick={() => toggle('lifeCycle')} aria-expanded={isOpen('lifeCycle')}>
              <span className={styles.sectionIcon}>⟳</span> {t('plantDetail.lifeCycle')}
              <span className={`${styles.sectionArrow} ${isOpen('lifeCycle') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('lifeCycle') && (
              <div className={styles.sectionBody}>
                {lifeCycleChips.length > 0 && (
                  <div className={styles.lifeCycleRow}>
                    {lifeCycleChips.map((chip) => (
                      <span key={chip} className={styles.lifeCycleChip}>{chip}</span>
                    ))}
                  </div>
                )}
                <div className={styles.attrGrid}>
                  <Attr label={t('plantDetail.lifespan')} value={d.lifespan} />
                  <Attr label={t('plantDetail.deciduousEvergreen')} value={d.deciduous_evergreen} />
                  <Attr label={t('plantDetail.habit')} value={d.habit} />
                  <Attr label={t('plantDetail.activeGrowth')} value={d.active_growth_period} />
                  <Attr label={t('plantDetail.bloomPeriod')} value={d.bloom_period} />
                  <Attr label={t('plantDetail.flowerColor')} value={d.flower_color} />
                </div>
              </div>
            )}
          </section>
        )}

        {/* LIGHT & CLIMATE */}
        {hasLight && (
          <section className={`${styles.section} ${styles.sectionLight}`} aria-label={t('plantDetail.lightClimate')}>
            <button type="button" className={toggleClass('light')} onClick={() => toggle('light')} aria-expanded={isOpen('light')}>
              <span className={styles.sectionIcon}>☀</span> {t('plantDetail.lightClimate')}
              <span className={`${styles.sectionArrow} ${isOpen('light') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('light') && (
              <div className={styles.sectionBody}>
                {/* Sun chips */}
                {(d.tolerates_full_sun !== null || d.tolerates_semi_shade !== null || d.tolerates_full_shade !== null) && (
                  <div className={styles.sunRow} aria-label={t('plantDetail.sunTolerance')}>
                    {d.tolerates_full_sun !== null && (
                      <span className={`${styles.sunChip} ${d.tolerates_full_sun ? styles.sunChipSun : ''}`}>
                        ☀ {t('plantDetail.fullSun')}
                      </span>
                    )}
                    {d.tolerates_semi_shade !== null && (
                      <span className={`${styles.sunChip} ${d.tolerates_semi_shade ? styles.sunChipShade : ''}`}>
                        ◐ {t('plantDetail.semiShade')}
                      </span>
                    )}
                    {d.tolerates_full_shade !== null && (
                      <span className={`${styles.sunChip} ${d.tolerates_full_shade ? styles.sunChipShade : ''}`}>
                        ● {t('plantDetail.fullShade')}
                      </span>
                    )}
                  </div>
                )}
                <div className={styles.attrGrid}>
                  <Attr label={t('plantDetail.droughtTolerance')} value={d.drought_tolerance} />
                  {d.frost_tender !== null && (
                    <div className={styles.attrItem}>
                      <span className={styles.attrLabel}>{t('plantDetail.frostTender')}</span>
                      <span className={styles.attrValue}>
                        {d.frost_tender ? t('plantDetail.yes') : t('plantDetail.no')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* SOIL */}
        {hasSoil && (
          <section className={`${styles.section} ${styles.sectionSoil}`} aria-label={t('plantDetail.soil')}>
            <button type="button" className={toggleClass('soil')} onClick={() => toggle('soil')} aria-expanded={isOpen('soil')}>
              <span className={styles.sectionIcon}>⬡</span> {t('plantDetail.soil')}
              <span className={`${styles.sectionArrow} ${isOpen('soil') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('soil') && (
              <div className={styles.sectionBody}>
                {phStr !== null && (
                  <div className={styles.attrGrid}>
                    <Attr label={t('plantDetail.soilPh')} value={phStr} />
                  </div>
                )}
                <div className={styles.boolRow}>
                  <BoolChip label={t('plantDetail.wellDrained')} value={d.well_drained} />
                  <BoolChip label={t('plantDetail.heavyClay')} value={d.heavy_clay} />
                  <BoolChip label={t('plantDetail.toleratesAcid')} value={d.tolerates_acid} />
                  <BoolChip label={t('plantDetail.toleratesAlkaline')} value={d.tolerates_alkaline} />
                  <BoolChip label={t('plantDetail.toleratesSaline')} value={d.tolerates_saline} />
                  <BoolChip label={t('plantDetail.toleratesWind')} value={d.tolerates_wind} />
                  <BoolChip label={t('plantDetail.toleratesPollution')} value={d.tolerates_pollution} />
                  <BoolChip label={t('plantDetail.toleratesPoorSoil')} value={d.tolerates_nutritionally_poor} />
                </div>
              </div>
            )}
          </section>
        )}

        {/* ECOLOGY */}
        {hasEcology && (
          <section className={`${styles.section} ${styles.sectionEcology}`} aria-label={t('plantDetail.ecology')}>
            <button type="button" className={toggleClass('ecology')} onClick={() => toggle('ecology')} aria-expanded={isOpen('ecology')}>
              <span className={styles.sectionIcon}>⚘</span> {t('plantDetail.ecology')}
              <span className={`${styles.sectionArrow} ${isOpen('ecology') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('ecology') && (
              <div className={styles.sectionBody}>
                <div className={styles.attrGrid}>
                  <Attr label={t('plantDetail.stratum')} value={d.stratum} />
                  <Attr label={t('plantDetail.successionStage')} value={d.succession_stage} />
                </div>
                <div className={styles.boolRow}>
                  <BoolChip label={t('plantDetail.nitrogenFixer')} value={d.nitrogen_fixer} />
                  <BoolChip label={t('plantDetail.attractsWildlife')} value={d.attracts_wildlife} />
                  <BoolChip label={t('plantDetail.scented')} value={d.scented} />
                </div>
              </div>
            )}
          </section>
        )}

        {/* USES */}
        {hasUses && (
          <section className={`${styles.section} ${styles.sectionUses}`} aria-label={t('plantDetail.uses')}>
            <button type="button" className={toggleClass('uses')} onClick={() => toggle('uses')} aria-expanded={isOpen('uses')}>
              <span className={styles.sectionIcon}>●</span> {t('plantDetail.uses')}
              <span className={`${styles.sectionArrow} ${isOpen('uses') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('uses') && (
              <div>
                <UsesSection
                  uses={d.uses}
                  edibilityRating={d.edibility_rating}
                  medicinalRating={d.medicinal_rating}
                  otherUsesRating={d.other_uses_rating}
                />
                {(d.edible_uses !== null || d.medicinal_uses !== null || d.other_uses !== null) && (
                  <div className={styles.sectionBody}>
                    <TextBlock label={t('plantDetail.edibleUses')} text={d.edible_uses} />
                    <TextBlock label={t('plantDetail.medicinalUses')} text={d.medicinal_uses} />
                    <TextBlock label={t('plantDetail.otherUsesText')} text={d.other_uses} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* RISK */}
        {hasRisk && (
          <section className={`${styles.section} ${styles.sectionRisk}`} aria-label={t('plantDetail.risk')}>
            <button type="button" className={toggleClass('risk')} onClick={() => toggle('risk')} aria-expanded={isOpen('risk')}>
              <span className={styles.sectionIcon}>⚠</span> {t('plantDetail.risk')}
              <span className={`${styles.sectionArrow} ${isOpen('risk') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('risk') && (
              <div className={styles.sectionBody}>
                <TextBlock label={t('plantDetail.toxicity')} text={d.toxicity} />
                <TextBlock label={t('plantDetail.knownHazards')} text={d.known_hazards} />
              </div>
            )}
          </section>
        )}

        {/* NOTES */}
        {hasNotes && (
          <section className={`${styles.section} ${styles.sectionNotes}`} aria-label={t('plantDetail.notes')}>
            <button type="button" className={toggleClass('notes')} onClick={() => toggle('notes')} aria-expanded={isOpen('notes')}>
              <span className={styles.sectionIcon}>✎</span> {t('plantDetail.notes')}
              <span className={`${styles.sectionArrow} ${isOpen('notes') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('notes') && (
              <div className={styles.sectionBody}>
                <TextBlock label={t('plantDetail.summary')} text={d.summary} />
                <TextBlock label={t('plantDetail.cultivationNotes')} text={d.cultivation_notes} />
                <TextBlock label={t('plantDetail.propagationNotes')} text={d.propagation_notes} />
                <TextBlock label={t('plantDetail.nativeRange')} text={d.native_range} />
                <TextBlock label={t('plantDetail.carbonFarming')} text={d.carbon_farming} />
              </div>
            )}
          </section>
        )}

        {/* RELATED SPECIES */}
        {hasRelated && (
          <section className={`${styles.section} ${styles.sectionRelated}`} aria-label={t('plantDetail.relatedSpecies')}>
            <button type="button" className={toggleClass('related')} onClick={() => toggle('related')} aria-expanded={isOpen('related')}>
              <span className={styles.sectionIcon}>⇄</span>
              {t('plantDetail.relatedSpecies')}
              {` (${d.relationships.length})`}
              <span className={`${styles.sectionArrow} ${isOpen('related') ? styles.sectionArrowOpen : ''}`}>›</span>
            </button>
            {isOpen('related') && (
              <RelationshipList relationships={d.relationships} />
            )}
          </section>
        )}

      </div>
    </div>
  );
}
