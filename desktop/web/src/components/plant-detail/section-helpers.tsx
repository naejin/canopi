import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import { ControlIcon } from '../shared/ControlIcon';
import row from '../shared/species-row.module.css';
import { formatNumber } from '../species-detail/species-facts';
import styles from './PlantDetail.module.css';

/** A recorded yes/no trait; unrecorded traits do not render. */
export function BoolChip({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <li className={`${styles.boolChip} ${value ? styles.boolChipTrue : ''}`}>
      <ControlIcon name={value ? 'check' : 'close'} size={16} />
      <span>{label}<span className={row.srOnly}> {value ? t('plantDetail.yes') : t('plantDetail.no')}</span></span>
    </li>
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
      <dt className={styles.attrLabel}>{label}</dt>
      <dd className={styles.attrValue}>{value}</dd>
    </div>
  );
}

/** A number as recorded (up to two decimals, grouped for the interface language) with its unit. */
export function NumAttr({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  if (value === null) return null;
  return <Attr label={label} value={`${formatNumber(value, locale.value, 2)}${unit ?? ''}`} />;
}

/** Format a min/max precipitation range with directional prefixes. */
export function formatPrecipRange(min: number | null, max: number | null): string | null {
  const u = t('plantDetail.inchesUnit');
  const n = (value: number) => formatNumber(value, locale.value);
  if (min !== null && max !== null) return `${n(min)}–${n(max)} ${u}`;
  if (min !== null) return `${n(min)}+ ${u}`;
  if (max !== null) return `≤${n(max)} ${u}`;
  return null;
}
