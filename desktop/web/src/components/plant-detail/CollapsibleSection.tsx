import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import styles from './PlantDetail.module.css';

interface Props {
  id: string;
  icon: string;
  titleKey: string;
  accentClass?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: ComponentChildren;
  /** Optional suffix after the title (e.g., count badge) */
  titleSuffix?: string;
}

export function CollapsibleSection({ id, icon, titleKey, accentClass, expanded, onToggle, children, titleSuffix }: Props) {
  const open = expanded.has(id);
  return (
    <section className={`${styles.section} ${accentClass ?? ''}`} aria-label={t(titleKey)}>
      <button
        type="button"
        className={`${styles.sectionTitleToggle} ${open ? styles.sectionTitleToggleOpen : ''}`}
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className={styles.sectionIcon}>{icon}</span>
        {t(titleKey)}{titleSuffix ?? ''}
        <span className={`${styles.sectionArrow} ${open ? styles.sectionArrowOpen : ''}`}>›</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}
