import { t } from '../../i18n';
import { speciesCatalogWorkbench, type ViewMode } from '../../app/plant-browser';
import styles from './PlantDb.module.css';

interface ViewOption {
  mode: ViewMode;
  labelKey: string;
  icon: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  { mode: 'list', labelKey: 'plantDb.viewList', icon: '☰' },
  { mode: 'card', labelKey: 'plantDb.viewCard', icon: '⊞' },
];

export function ViewModeToggle() {
  const current = speciesCatalogWorkbench.viewMode.value;

  return (
    <div className={styles.viewToggle} role="group" aria-label={t('plantDb.viewMode')}>
      {VIEW_OPTIONS.map(({ mode, labelKey, icon }) => (
        <button
          key={mode}
          type="button"
          className={`${styles.viewBtn} ${current === mode ? styles.viewBtnActive : ''}`}
          onClick={() => {
            speciesCatalogWorkbench.setViewMode(mode);
          }}
          aria-label={t(labelKey)}
          aria-pressed={current === mode}
          title={t(labelKey)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
