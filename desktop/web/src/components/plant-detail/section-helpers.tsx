import { t } from '../../i18n';
import styles from './PlantDetail.module.css';

export function BoolChip({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <span className={`${styles.boolChip} ${value ? styles.boolChipTrue : ''}`}>
      {value ? '✓' : '✗'} {label}
    </span>
  );
}

export function TextBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className={styles.textItem}>
      <span className={styles.attrLabel}>{label}</span>
      <p className={styles.textContent}>{text}</p>
    </div>
  );
}

export function Attr({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.attrItem}>
      <span className={styles.attrLabel}>{label}</span>
      <span className={styles.attrValue}>{value}</span>
    </div>
  );
}

/** Format a min/max precipitation range with directional prefixes. */
export function formatPrecipRange(min: number | null, max: number | null): string | null {
  const u = t('plantDetail.inchesUnit');
  if (min !== null && max !== null) return `${min}–${max} ${u}`;
  if (min !== null) return `${min}+ ${u}`;
  if (max !== null) return `≤${max} ${u}`;
  return null;
}

export function NumAttr({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  if (value === null) return null;
  return (
    <div className={styles.attrItem}>
      <span className={styles.attrLabel}>{label}</span>
      <span className={styles.attrValue}>{value}{unit ?? ''}</span>
    </div>
  );
}
