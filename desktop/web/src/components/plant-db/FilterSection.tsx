import { useSignal } from '@preact/signals';
import { t } from '../../i18n';
import styles from './PlantDb.module.css';

interface CheckboxOption {
  value: string;
  label: string;
}

interface Props {
  title: string;
  type: 'checkboxes' | 'range' | 'toggle';
  options?: CheckboxOption[];
  selected?: string[];
  onToggleOption?: (value: string) => void;
  rangeMin?: number | null;
  rangeMax?: number | null;
  onRangeMin?: (v: number | null) => void;
  onRangeMax?: (v: number | null) => void;
  rangeAbsMin?: number;
  rangeAbsMax?: number;
  toggleValue?: boolean | null;
  onToggle?: (v: boolean | null) => void;
  toggleLabel?: string;
}

export function FilterSection({
  title,
  type,
  options,
  selected,
  onToggleOption,
  rangeMin,
  rangeMax,
  onRangeMin,
  onRangeMax,
  rangeAbsMin,
  rangeAbsMax,
  toggleValue,
  onToggle,
  toggleLabel,
}: Props) {
  const open = useSignal(false);

  return (
    <div className={styles.filterSection}>
      <button
        type="button"
        className={styles.filterSectionBtn}
        onClick={() => {
          open.value = !open.value;
        }}
        aria-expanded={open.value}
      >
        {title}
        <span
          className={`${styles.filterSectionChevron} ${open.value ? styles.filterSectionChevronOpen : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {open.value && (
        <div className={styles.filterSectionContent}>
          {type === 'checkboxes' && options && onToggleOption && (
            options.map((opt) => {
              const id = `filter-${title}-${opt.value}`;
              const checked = selected?.includes(opt.value) ?? false;
              return (
                <label key={opt.value} className={styles.filterCheckRow} htmlFor={id}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={() => onToggleOption(opt.value)}
                  />
                  <span className={styles.filterCheckLabel}>{opt.label}</span>
                </label>
              );
            })
          )}

          {type === 'range' && onRangeMin && onRangeMax && (
            <div className={styles.filterRangeRow}>
              <input
                type="number"
                className={styles.filterRangeInput}
                value={rangeMin ?? ''}
                min={rangeAbsMin}
                max={rangeAbsMax}
                aria-label={t('plantDb.filterHardiness') + ' min'}
                onInput={(e) => {
                  const v = e.currentTarget.value;
                  onRangeMin(v === '' ? null : Number(v));
                }}
              />
              <span className={styles.filterRangeSep}>–</span>
              <input
                type="number"
                className={styles.filterRangeInput}
                value={rangeMax ?? ''}
                min={rangeAbsMin}
                max={rangeAbsMax}
                aria-label={t('plantDb.filterHardiness') + ' max'}
                onInput={(e) => {
                  const v = e.currentTarget.value;
                  onRangeMax(v === '' ? null : Number(v));
                }}
              />
            </div>
          )}

          {type === 'toggle' && onToggle && (
            <label className={styles.filterCheckRow} htmlFor={`filter-toggle-${title}`}>
              <input
                type="checkbox"
                id={`filter-toggle-${title}`}
                checked={toggleValue === true}
                onChange={(e) => {
                  onToggle(e.currentTarget.checked ? true : null);
                }}
              />
              <span className={styles.filterCheckLabel}>
                {toggleLabel ?? title}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
