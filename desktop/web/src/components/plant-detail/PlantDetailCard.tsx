import { useSignal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import { t } from '../../i18n';
import { locale } from '../../state/app';
import {
  selectedCanonicalName,
  favoriteNames,
  toggleFavoriteAction,
} from '../../state/plant-db';
import { getSpeciesDetail, getLocaleCommonNames } from '../../ipc/species';
import type { SpeciesDetail, CommonNameEntry } from '../../types/species';
import { AttributeGrid } from './AttributeGrid';
import { UsesSection } from './UsesSection';
import { RiskDistributionSection } from './RiskDistributionSection';
import { RelationshipList } from './RelationshipList';
import { CollapsibleSection } from './CollapsibleSection';
import { PhotoCarousel } from './PhotoCarousel';
import { Attr, BoolChip, NumAttr, formatPrecipRange } from './section-helpers';
import styles from './PlantDetail.module.css';

interface Props {
  canonicalName: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

// ── Component ───────────────────────────────────────────────────────────────

export function PlantDetailCard({ canonicalName }: Props) {
  void locale.value;

  const detail = useSignal<SpeciesDetail | null>(null);
  const loadState = useSignal<LoadState>('loading');
  const errorMsg = useSignal<string | null>(null);
  const expanded = useSignal<Set<string>>(new Set());
  const retryCount = useSignal(0);
  const secondaryNames = useSignal<CommonNameEntry[]>([]);

  useSignalEffect(() => {
    const name = selectedCanonicalName.value ?? canonicalName;
    const loc = locale.value;
    void retryCount.value;

    detail.value = null;
    loadState.value = 'loading';
    errorMsg.value = null;
    secondaryNames.value = [];

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

    // Fetch locale common names (non-blocking — detail card renders without them)
    getLocaleCommonNames(name, loc)
      .then((entries) => {
        if (cancelled) return;
        secondaryNames.value = entries;
      })
      .catch(() => {
        // Silently ignore — secondary names are optional
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

  // ── Section visibility checks ────────────────────────────────────────────

  const hasLifeCycle = d.is_annual !== null || d.is_biennial !== null || d.is_perennial !== null
    || d.lifespan !== null || d.deciduous_evergreen !== null || d.habit !== null
    || d.active_growth_period !== null || d.bloom_period !== null || d.flower_color !== null
    || d.leaf_retention !== null || d.pollinators !== null;

  const hasUses = d.uses.length > 0 || d.edibility_rating !== null || d.medicinal_rating !== null
    || d.other_uses_rating !== null;

  const hasLight = d.tolerates_full_sun !== null || d.tolerates_semi_shade !== null
    || d.tolerates_full_shade !== null || d.frost_tender !== null || d.drought_tolerance !== null
    || d.frost_free_days_min !== null || d.precip_min_inches !== null || d.precip_max_inches !== null
    || d.climate_zones !== null;

  const hasSoil = d.soil_ph_min !== null || d.soil_ph_max !== null
    || d.well_drained !== null || d.heavy_clay !== null || d.tolerates_acid !== null
    || d.tolerates_alkaline !== null || d.tolerates_saline !== null || d.tolerates_wind !== null
    || d.tolerates_pollution !== null || d.tolerates_nutritionally_poor !== null
    || d.tolerates_light_soil !== null || d.tolerates_medium_soil !== null || d.tolerates_heavy_soil !== null
    || d.fertility_requirement !== null || d.moisture_use !== null
    || d.anaerobic_tolerance !== null || d.root_depth_min_cm !== null
    || d.salinity_tolerance !== null;

  const hasEcology = d.stratum !== null || d.succession_stage !== null || d.nitrogen_fixer !== null
    || d.attracts_wildlife !== null || d.scented !== null
    || d.ecological_system !== null || d.mycorrhizal_type !== null || d.grime_strategy !== null
    || d.raunkiaer_life_form !== null || d.cn_ratio !== null || d.allelopathic !== null
    || d.root_system_type !== null || d.taproot_persistent !== null
    || d.ellenberg_light !== null || d.ellenberg_temperature !== null
    || d.ellenberg_moisture !== null || d.ellenberg_reaction !== null
    || d.ellenberg_nitrogen !== null || d.ellenberg_salt !== null
    || d.photosynthesis_pathway !== null;

  const hasGrowthForm = d.growth_form_type !== null || d.growth_form_shape !== null
    || d.growth_habit !== null || d.woody !== null || d.canopy_position !== null
    || d.resprout_ability !== null || d.coppice_potential !== null
    || d.wood_density_g_cm3 !== null;

  const hasPropagation = d.propagated_by_seed !== null || d.propagated_by_cuttings !== null
    || d.propagated_by_bare_root !== null || d.propagated_by_container !== null
    || d.propagated_by_sprigs !== null || d.propagated_by_bulb !== null
    || d.propagated_by_sod !== null || d.propagated_by_tubers !== null
    || d.propagated_by_corm !== null || d.cold_stratification_required !== null
    || d.vegetative_spread_rate !== null || d.seed_spread_rate !== null
    || d.propagation_method !== null || d.sowing_period !== null
    || d.harvest_period !== null || d.dormancy_conditions !== null
    || d.management_types !== null;

  const hasFruitSeed = d.fruit_type !== null || d.fruit_seed_color !== null
    || d.fruit_seed_period_begin !== null || d.fruit_seed_period_end !== null
    || d.fruit_seed_abundance !== null || d.fruit_seed_persistence !== null
    || d.seed_mass_mg !== null || d.seed_length_mm !== null
    || d.seed_germination_rate !== null || d.seed_dispersal_mechanism !== null
    || d.seed_storage_behaviour !== null || d.seed_dormancy_type !== null
    || d.seed_dormancy_depth !== null || d.serotinous !== null
    || d.seedbank_type !== null;

  const hasLeaf = d.leaf_type !== null || d.leaf_compoundness !== null
    || d.leaf_shape !== null || d.sla_mm2_mg !== null || d.ldmc_g_g !== null
    || d.leaf_nitrogen_mg_g !== null || d.leaf_carbon_mg_g !== null
    || d.leaf_phosphorus_mg_g !== null || d.leaf_dry_mass_mg !== null;

  const hasReproduction = d.pollination_syndrome !== null || d.sexual_system !== null
    || d.mating_system !== null || d.self_fertile !== null
    || d.reproductive_type !== null || d.clonal_growth_form !== null || d.storage_organ !== null;

  const hasRelated = d.relationships.length > 0;

  const hasIdentity = d.taxonomic_order !== null || d.taxonomic_class !== null || d.is_hybrid !== null;

  // ── Derived values ───────────────────────────────────────────────────────

  const phStr =
    d.soil_ph_min !== null && d.soil_ph_max !== null
      ? `${d.soil_ph_min}–${d.soil_ph_max}`
      : d.soil_ph_min !== null
        ? `${d.soil_ph_min}+`
        : null;

  const lifeCycleChips: string[] = [];
  if (d.is_annual === true) lifeCycleChips.push(t('plantDetail.annual'));
  if (d.is_biennial === true) lifeCycleChips.push(t('plantDetail.biennial'));
  if (d.is_perennial === true) lifeCycleChips.push(t('plantDetail.perennial'));

  const precipStr = formatPrecipRange(d.precip_min_inches, d.precip_max_inches);

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
          {(() => {
            // Filter out the primary name already displayed above
            const others = secondaryNames.value.filter(
              (entry) => entry.name !== d.common_name,
            );
            if (others.length === 0) return null;
            const MAX_SHOWN = 2;
            const shown = others.slice(0, MAX_SHOWN);
            const remaining = others.length - MAX_SHOWN;
            return (
              <span className={styles.secondaryNames}>
                {shown.map((e) => e.name).join(' · ')}
                {remaining > 0 && ` ${t('plantDb.andMore', { count: remaining })}`}
              </span>
            );
          })()}
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

        {/* 0. PHOTOS */}
        <PhotoCarousel canonicalName={d.canonical_name} />

        {/* 1. DIMENSIONS — always open */}
        <section className={`${styles.section} ${styles.sectionDimensions}`} aria-label={t('plantDetail.dimensions')}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>↕</span> {t('plantDetail.dimensions')}
          </h3>
          <div className={styles.sectionBody}>
            <AttributeGrid detail={d} />
          </div>
        </section>

        {/* 2. LIFE CYCLE */}
        {hasLifeCycle && (
          <CollapsibleSection id="lifeCycle" icon="⟳" titleKey="plantDetail.lifeCycle"
            accentClass={styles.sectionLifeCycle} expanded={expanded.value} onToggle={toggle}>
            {lifeCycleChips.length > 0 && (
              <div className={styles.lifeCycleRow}>
                {lifeCycleChips.map((chip) => (
                  <span key={chip} className={styles.lifeCycleChip}>{chip}</span>
                ))}
              </div>
            )}
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.habit')} value={d.habit} />
              <Attr label={t('plantDetail.lifespan')} value={d.lifespan} />
              <Attr label={t('plantDetail.deciduousEvergreen')} value={d.deciduous_evergreen} />
              <Attr label={t('plantDetail.activeGrowth')} value={d.active_growth_period} />
              <Attr label={t('plantDetail.bloomPeriod')} value={d.bloom_period} />
              <Attr label={t('plantDetail.flowerColor')} value={d.flower_color} />
              <Attr label={t('plantDetail.pollinators')} value={d.pollinators} />
            </div>
            {d.leaf_retention !== null && (
              <div className={styles.boolRow}>
                <BoolChip label={t('plantDetail.leafRetention')} value={d.leaf_retention} />
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* 3. USES */}
        {hasUses && (
          <CollapsibleSection id="uses" icon="●" titleKey="plantDetail.uses"
            accentClass={styles.sectionUses} expanded={expanded.value} onToggle={toggle}>
            <UsesSection
              uses={d.uses}
              edibilityRating={d.edibility_rating}
              medicinalRating={d.medicinal_rating}
              otherUsesRating={d.other_uses_rating}
            />
          </CollapsibleSection>
        )}

        {/* 4. LIGHT & CLIMATE */}
        {hasLight && (
          <CollapsibleSection id="light" icon="☀" titleKey="plantDetail.lightClimate"
            accentClass={styles.sectionLight} expanded={expanded.value} onToggle={toggle}>
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
              <NumAttr label={t('plantDetail.frostFreeDays')} value={d.frost_free_days_min} unit={` ${t('plantDetail.daysUnit')}`} />
              <Attr label={t('plantDetail.precipRange')} value={precipStr} />
              <Attr label={t('plantDetail.climateZones')} value={d.climate_zones} />
            </div>
          </CollapsibleSection>
        )}

        {/* 5. SOIL */}
        {hasSoil && (
          <CollapsibleSection id="soil" icon="⬡" titleKey="plantDetail.soil"
            accentClass={styles.sectionSoil} expanded={expanded.value} onToggle={toggle}>
            {(phStr !== null || d.fertility_requirement !== null || d.moisture_use !== null
              || d.anaerobic_tolerance !== null || d.root_depth_min_cm !== null || d.salinity_tolerance !== null) && (
              <div className={styles.attrGrid}>
                <Attr label={t('plantDetail.soilPh')} value={phStr} />
                <Attr label={t('plantDetail.fertilityRequirement')} value={d.fertility_requirement} />
                <Attr label={t('plantDetail.moistureUse')} value={d.moisture_use} />
                <Attr label={t('plantDetail.anaerobicTolerance')} value={d.anaerobic_tolerance} />
                <Attr label={t('plantDetail.salinityTolerance')} value={d.salinity_tolerance} />
                <NumAttr label={t('plantDetail.rootDepth')} value={d.root_depth_min_cm} unit=" cm" />
              </div>
            )}
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.wellDrained')} value={d.well_drained} />
              <BoolChip label={t('plantDetail.heavyClay')} value={d.heavy_clay} />
              <BoolChip label={t('plantDetail.toleratesLightSoil')} value={d.tolerates_light_soil} />
              <BoolChip label={t('plantDetail.toleratesMediumSoil')} value={d.tolerates_medium_soil} />
              <BoolChip label={t('plantDetail.toleratesHeavySoil')} value={d.tolerates_heavy_soil} />
              <BoolChip label={t('plantDetail.toleratesAcid')} value={d.tolerates_acid} />
              <BoolChip label={t('plantDetail.toleratesAlkaline')} value={d.tolerates_alkaline} />
              <BoolChip label={t('plantDetail.toleratesSaline')} value={d.tolerates_saline} />
              <BoolChip label={t('plantDetail.toleratesWind')} value={d.tolerates_wind} />
              <BoolChip label={t('plantDetail.toleratesPollution')} value={d.tolerates_pollution} />
              <BoolChip label={t('plantDetail.toleratesPoorSoil')} value={d.tolerates_nutritionally_poor} />
            </div>
          </CollapsibleSection>
        )}

        {/* 6. ECOLOGY */}
        {hasEcology && (
          <CollapsibleSection id="ecology" icon="⚘" titleKey="plantDetail.ecology"
            accentClass={styles.sectionEcology} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.stratum')} value={d.stratum} />
              <Attr label={t('plantDetail.successionStage')} value={d.succession_stage} />
              <Attr label={t('plantDetail.ecologicalSystem')} value={d.ecological_system} />
              <Attr label={t('plantDetail.mycorrhizalType')} value={d.mycorrhizal_type} />
              <Attr label={t('plantDetail.grimeStrategy')} value={d.grime_strategy} />
              <Attr label={t('plantDetail.raunkiaerLifeForm')} value={d.raunkiaer_life_form} />
              <Attr label={t('plantDetail.cnRatio')} value={d.cn_ratio} />
              <Attr label={t('plantDetail.rootSystemType')} value={d.root_system_type} />
              <Attr label={t('plantDetail.photosynthesisPathway')} value={d.photosynthesis_pathway} />
            </div>
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.nitrogenFixer')} value={d.nitrogen_fixer} />
              <BoolChip label={t('plantDetail.attractsWildlife')} value={d.attracts_wildlife} />
              <BoolChip label={t('plantDetail.scented')} value={d.scented} />
              <BoolChip label={t('plantDetail.allelopathic')} value={d.allelopathic} />
              <BoolChip label={t('plantDetail.taprootPersistent')} value={d.taproot_persistent} />
            </div>
            {(d.ellenberg_light !== null || d.ellenberg_temperature !== null || d.ellenberg_moisture !== null
              || d.ellenberg_reaction !== null || d.ellenberg_nitrogen !== null || d.ellenberg_salt !== null) && (
              <div className={styles.attrGrid}>
                <NumAttr label={t('plantDetail.ellenbergLight')} value={d.ellenberg_light} />
                <NumAttr label={t('plantDetail.ellenbergTemperature')} value={d.ellenberg_temperature} />
                <NumAttr label={t('plantDetail.ellenbergMoisture')} value={d.ellenberg_moisture} />
                <NumAttr label={t('plantDetail.ellenbergReaction')} value={d.ellenberg_reaction} />
                <NumAttr label={t('plantDetail.ellenbergNitrogen')} value={d.ellenberg_nitrogen} />
                <NumAttr label={t('plantDetail.ellenbergSalt')} value={d.ellenberg_salt} />
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* 7. GROWTH FORM */}
        {hasGrowthForm && (
          <CollapsibleSection id="growthForm" icon="⌘" titleKey="plantDetail.growthForm"
            accentClass={styles.sectionGrowthForm} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.growthFormType')} value={d.growth_form_type} />
              <Attr label={t('plantDetail.growthFormShape')} value={d.growth_form_shape} />
              <Attr label={t('plantDetail.growthHabit')} value={d.growth_habit} />
              <Attr label={t('plantDetail.canopyPosition')} value={d.canopy_position} />
              <NumAttr label={t('plantDetail.woodDensity')} value={d.wood_density_g_cm3} unit=" g/cm³" />
            </div>
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.woody')} value={d.woody} />
              <BoolChip label={t('plantDetail.resproutAbility')} value={d.resprout_ability} />
              <BoolChip label={t('plantDetail.coppicePotential')} value={d.coppice_potential} />
            </div>
          </CollapsibleSection>
        )}

        {/* 8. PROPAGATION */}
        {hasPropagation && (
          <CollapsibleSection id="propagation" icon="⌥" titleKey="plantDetail.propagation"
            accentClass={styles.sectionPropagation} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.propagatedBySeed')} value={d.propagated_by_seed} />
              <BoolChip label={t('plantDetail.propagatedByCuttings')} value={d.propagated_by_cuttings} />
              <BoolChip label={t('plantDetail.propagatedByBareRoot')} value={d.propagated_by_bare_root} />
              <BoolChip label={t('plantDetail.propagatedByContainer')} value={d.propagated_by_container} />
              <BoolChip label={t('plantDetail.propagatedBySprigs')} value={d.propagated_by_sprigs} />
              <BoolChip label={t('plantDetail.propagatedByBulb')} value={d.propagated_by_bulb} />
              <BoolChip label={t('plantDetail.propagatedBySod')} value={d.propagated_by_sod} />
              <BoolChip label={t('plantDetail.propagatedByTubers')} value={d.propagated_by_tubers} />
              <BoolChip label={t('plantDetail.propagatedByCorm')} value={d.propagated_by_corm} />
              <BoolChip label={t('plantDetail.coldStratificationRequired')} value={d.cold_stratification_required} />
            </div>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.propagationMethod')} value={d.propagation_method} />
              <Attr label={t('plantDetail.vegetativeSpreadRate')} value={d.vegetative_spread_rate} />
              <Attr label={t('plantDetail.seedSpreadRate')} value={d.seed_spread_rate} />
              <Attr label={t('plantDetail.sowingPeriod')} value={d.sowing_period} />
              <Attr label={t('plantDetail.harvestPeriod')} value={d.harvest_period} />
              <Attr label={t('plantDetail.dormancyConditions')} value={d.dormancy_conditions} />
              <Attr label={t('plantDetail.managementTypes')} value={d.management_types} />
            </div>
          </CollapsibleSection>
        )}

        {/* 9. FRUIT & SEED */}
        {hasFruitSeed && (
          <CollapsibleSection id="fruitSeed" icon="❋" titleKey="plantDetail.fruitSeed"
            accentClass={styles.sectionFruitSeed} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.fruitType')} value={d.fruit_type} />
              <Attr label={t('plantDetail.fruitSeedColor')} value={d.fruit_seed_color} />
              <Attr label={t('plantDetail.fruitSeedPeriodBegin')} value={d.fruit_seed_period_begin} />
              <Attr label={t('plantDetail.fruitSeedPeriodEnd')} value={d.fruit_seed_period_end} />
              <Attr label={t('plantDetail.fruitSeedAbundance')} value={d.fruit_seed_abundance} />
              <NumAttr label={t('plantDetail.seedMass')} value={d.seed_mass_mg} unit=" mg" />
              <NumAttr label={t('plantDetail.seedLength')} value={d.seed_length_mm} unit=" mm" />
              <NumAttr label={t('plantDetail.seedGerminationRate')} value={d.seed_germination_rate} unit="%" />
              <Attr label={t('plantDetail.seedDispersalMechanism')} value={d.seed_dispersal_mechanism} />
              <Attr label={t('plantDetail.seedStorageBehaviour')} value={d.seed_storage_behaviour} />
              <Attr label={t('plantDetail.seedDormancyType')} value={d.seed_dormancy_type} />
              <Attr label={t('plantDetail.seedDormancyDepth')} value={d.seed_dormancy_depth} />
              <Attr label={t('plantDetail.seedbankType')} value={d.seedbank_type} />
            </div>
            {(d.fruit_seed_persistence !== null || d.serotinous !== null) && (
              <div className={styles.boolRow}>
                <BoolChip label={t('plantDetail.fruitSeedPersistence')} value={d.fruit_seed_persistence} />
                <BoolChip label={t('plantDetail.serotinous')} value={d.serotinous} />
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* 10. RISK & DISTRIBUTION */}
        <RiskDistributionSection d={d} expanded={expanded.value} onToggle={toggle} />

        {/* 11. LEAF */}
        {hasLeaf && (
          <CollapsibleSection id="leaf" icon="§" titleKey="plantDetail.leaf"
            accentClass={styles.sectionLeaf} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.leafType')} value={d.leaf_type} />
              <Attr label={t('plantDetail.leafCompoundness')} value={d.leaf_compoundness} />
              <Attr label={t('plantDetail.leafShape')} value={d.leaf_shape} />
              <NumAttr label={t('plantDetail.sla')} value={d.sla_mm2_mg} unit=" mm²/mg" />
              <NumAttr label={t('plantDetail.ldmc')} value={d.ldmc_g_g} unit=" g/g" />
              <NumAttr label={t('plantDetail.leafNitrogen')} value={d.leaf_nitrogen_mg_g} unit=" mg/g" />
              <NumAttr label={t('plantDetail.leafCarbon')} value={d.leaf_carbon_mg_g} unit=" mg/g" />
              <NumAttr label={t('plantDetail.leafPhosphorus')} value={d.leaf_phosphorus_mg_g} unit=" mg/g" />
              <NumAttr label={t('plantDetail.leafDryMass')} value={d.leaf_dry_mass_mg} unit=" mg" />
            </div>
          </CollapsibleSection>
        )}

        {/* 12. REPRODUCTION */}
        {hasReproduction && (
          <CollapsibleSection id="reproduction" icon="⚥" titleKey="plantDetail.reproduction"
            accentClass={styles.sectionReproduction} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.pollinationSyndrome')} value={d.pollination_syndrome} />
              <Attr label={t('plantDetail.sexualSystem')} value={d.sexual_system} />
              <Attr label={t('plantDetail.matingSystem')} value={d.mating_system} />
              <Attr label={t('plantDetail.reproductiveType')} value={d.reproductive_type} />
              <Attr label={t('plantDetail.clonalGrowthForm')} value={d.clonal_growth_form} />
              <Attr label={t('plantDetail.storageOrgan')} value={d.storage_organ} />
            </div>
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.selfFertile')} value={d.self_fertile} />
            </div>
          </CollapsibleSection>
        )}

        {/* 13. RELATED SPECIES */}
        {hasRelated && (
          <CollapsibleSection id="related" icon="⇄" titleKey="plantDetail.relatedSpecies"
            accentClass={styles.sectionRelated} expanded={expanded.value} onToggle={toggle}
            titleSuffix={` (${d.relationships.length})`}>
            <RelationshipList relationships={d.relationships} />
          </CollapsibleSection>
        )}

        {/* 15. IDENTITY (taxonomy — reference) */}
        {hasIdentity && (
          <CollapsibleSection id="identity" icon="¶" titleKey="plantDetail.identity"
            accentClass={styles.sectionIdentity} expanded={expanded.value} onToggle={toggle}>
            <div className={styles.attrGrid}>
              <Attr label={t('plantDetail.taxonomicOrder')} value={d.taxonomic_order} />
              <Attr label={t('plantDetail.taxonomicClass')} value={d.taxonomic_class} />
            </div>
            <div className={styles.boolRow}>
              <BoolChip label={t('plantDetail.isHybrid')} value={d.is_hybrid} />
            </div>
          </CollapsibleSection>
        )}

      </div>
    </div>
  );
}
