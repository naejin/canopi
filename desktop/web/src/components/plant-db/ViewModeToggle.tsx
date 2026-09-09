import { t } from '../../i18n';
import { speciesCatalogWorkbench, type ViewMode } from '../../app/plant-browser';
import { ButtonTooltip } from '../shared/ButtonTooltip';
import styles from './PlantDb.module.css';

interface ViewOption {
  mode: ViewMode;
  labelKey: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  { mode: 'list', labelKey: 'plantDb.viewList' },
  { mode: 'card', labelKey: 'plantDb.viewCard' },
];

export function ViewModeToggle() {
  const current = speciesCatalogWorkbench.viewMode.value;

  return (
    <div className={styles.viewToggle} role="group" aria-label={t('plantDb.viewMode')}>
      {VIEW_OPTIONS.map(({ mode, labelKey }) => (
        <button
          key={mode}
          type="button"
          className={`${styles.viewBtn} ${current === mode ? styles.viewBtnActive : ''}`}
          onClick={() => {
            speciesCatalogWorkbench.setViewMode(mode);
          }}
          aria-label={t(labelKey)}
          aria-pressed={current === mode}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {mode === 'list' ? (
              <path d="M3 5h1m3 0h10M3 10h1m3 0h10M3 15h1m3 0h10" />
            ) : (
              <>
                <rect x="3" y="3" width="5" height="5" rx="1" />
                <rect x="12" y="3" width="5" height="5" rx="1" />
                <rect x="3" y="12" width="5" height="5" rx="1" />
                <rect x="12" y="12" width="5" height="5" rx="1" />
              </>
            )}
          </svg>
          <ButtonTooltip label={t(labelKey)} side="left" />
        </button>
      ))}
    </div>
  );
}
