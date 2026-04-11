import { t } from '../../i18n';
import type { SpeciesDetail } from '../../types/species';
import { CollapsibleSection } from './CollapsibleSection';
import { Attr, BoolChip, TextBlock } from './section-helpers';
import styles from './PlantDetail.module.css';

interface Props {
  d: SpeciesDetail;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

export function RiskDistributionSection({ d, expanded, onToggle }: Props) {
  const hasData = d.toxicity !== null || d.invasive_potential !== null
    || d.biogeographic_status !== null || d.noxious_status !== null
    || d.invasive_usda !== null || d.weed_potential !== null
    || d.fire_resistant !== null || d.fire_tolerance !== null
    || d.hedge_tolerance !== null || d.native_distribution !== null
    || d.introduced_distribution !== null || d.climate_zones !== null;

  if (!hasData) return null;

  return (
    <CollapsibleSection id="risk" icon="⚠" titleKey="plantDetail.riskDistribution"
      accentClass={styles.sectionRisk} expanded={expanded} onToggle={onToggle}>
      <TextBlock label={t('plantDetail.toxicity')} text={d.toxicity} />
      <div className={styles.attrGrid}>
        <Attr label={t('plantDetail.invasivePotential')} value={d.invasive_potential} />
        <Attr label={t('plantDetail.biogeographicStatus')} value={d.biogeographic_status} />
        <Attr label={t('plantDetail.fireTolerance')} value={d.fire_tolerance} />
        <Attr label={t('plantDetail.hedgeTolerance')} value={d.hedge_tolerance} />
      </div>
      <div className={styles.boolRow}>
        <BoolChip label={t('plantDetail.noxiousStatus')} value={d.noxious_status} />
        <BoolChip label={t('plantDetail.weedPotential')} value={d.weed_potential} />
        <BoolChip label={t('plantDetail.invasiveUsda')} value={d.invasive_usda} />
        <BoolChip label={t('plantDetail.fireResistant')} value={d.fire_resistant} />
      </div>
      <TextBlock label={t('plantDetail.nativeDistribution')} text={d.native_distribution} />
      <TextBlock label={t('plantDetail.introducedDistribution')} text={d.introduced_distribution} />
      <TextBlock label={t('filters.climateZone')} text={d.climate_zones} />
    </CollapsibleSection>
  );
}
