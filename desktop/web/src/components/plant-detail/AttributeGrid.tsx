import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import type { SpeciesDetail } from '../../types/species';
import styles from './PlantDetail.module.css';

interface Props {
  detail: SpeciesDetail;
}

function formatRange(min: number | null, max: number | null, unit: string): string {
  if (min !== null && max !== null && min !== max) return `${min}–${max}${unit}`;
  if (max !== null) return `${max}${unit}`;
  if (min !== null) return `${min}${unit}`;
  return t('plantDetail.unknown');
}

function formatZone(min: number | null, max: number | null): string {
  if (min !== null && max !== null && min !== max) return `${t('plantDetail.zone')} ${min}–${max}`;
  if (min !== null) return `${t('plantDetail.zone')} ${min}`;
  return t('plantDetail.unknown');
}

export function AttributeGrid({ detail }: Props) {
  void locale.value;

  const heightStr = formatRange(detail.height_min_m, detail.height_max_m, 'm');
  const widthStr = detail.width_max_m !== null ? `${detail.width_max_m}m` : t('plantDetail.unknown');
  const zoneStr = formatZone(detail.hardiness_zone_min, detail.hardiness_zone_max);
  const growthStr = detail.growth_rate ?? t('plantDetail.unknown');

  return (
    <div className={styles.attrGrid}>
      <div className={styles.attrItem}>
        <span className={styles.attrLabel}>{t('plantDetail.height')}</span>
        <span className={`${styles.attrValue} ${styles.attrValueHeight}`}>{heightStr}</span>
      </div>

      <div className={styles.attrItem}>
        <span className={styles.attrLabel}>{t('plantDetail.width')}</span>
        <span className={`${styles.attrValue} ${styles.attrValueHeight}`}>{widthStr}</span>
      </div>

      <div className={styles.attrItem}>
        <span className={styles.attrLabel}>{t('plantDetail.hardiness')}</span>
        <span className={`${styles.attrValue} ${styles.attrValueHardiness}`}>{zoneStr}</span>
      </div>

      <div className={styles.attrItem}>
        <span className={styles.attrLabel}>{t('plantDetail.growthRate')}</span>
        <span className={styles.attrValue}>{growthStr}</span>
      </div>

      {detail.age_of_maturity_years !== null && (
        <div className={styles.attrItem}>
          <span className={styles.attrLabel}>{t('plantDetail.ageOfMaturity')}</span>
          <span className={styles.attrValue}>{detail.age_of_maturity_years} {t('plantDetail.yearUnit')}</span>
        </div>
      )}
    </div>
  );
}
