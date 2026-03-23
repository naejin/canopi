import { t } from '../../i18n';
import { locale } from '../../state/app';
import { toggleFavoriteAction, selectedCanonicalName } from '../../state/plant-db';
import type { SpeciesListItem } from '../../types/species';
import styles from './PlantDb.module.css';

interface Props {
  plant: SpeciesListItem;
  style?: string | Record<string, string | number>;
}

export function PlantRow({ plant, style }: Props) {
  void locale.value;

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData('text/plain', JSON.stringify({
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
    }));
    e.dataTransfer!.effectAllowed = 'copy';
  };

  const handleRowClick = () => {
    selectedCanonicalName.value = plant.canonical_name;
  };

  const handleRowKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectedCanonicalName.value = plant.canonical_name;
    }
  };

  const handleFavClick = (e: MouseEvent) => {
    e.stopPropagation();
    void toggleFavoriteAction(plant.canonical_name);
  };

  const favLabel = plant.is_favorite
    ? t('plantDb.removeFavorite')
    : t('plantDb.addFavorite');

  // Build hardiness string
  const hardiness =
    plant.hardiness_zone_min !== null
      ? plant.hardiness_zone_max !== null && plant.hardiness_zone_max !== plant.hardiness_zone_min
        ? `Z${plant.hardiness_zone_min}–${plant.hardiness_zone_max}`
        : `Z${plant.hardiness_zone_min}`
      : null;

  // Build height string
  const height = plant.height_max_m !== null ? `${plant.height_max_m}m` : null;

  return (
    <div
      className={styles.plantRow}
      draggable={true}
      onDragStart={handleDragStart}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      tabIndex={0}
      role="listitem"
      aria-label={plant.canonical_name}
      style={style as never}
    >
      <span
        className={styles.dragHandle}
        aria-hidden="true"
        title={t('plantDb.dragToCanvas')}
      >
        ≡
      </span>

      <div className={styles.plantRowContent}>
        {/* Row 1: Botanical name + common name */}
        <div className={styles.plantNames}>
          <span className={styles.botanicalName}>{plant.canonical_name}</span>
          {plant.common_name !== null && (
            <span className={styles.commonName}>{plant.common_name}</span>
          )}
        </div>

        {/* Row 2: Colored attribute chips */}
        <div className={styles.plantMeta}>
          <span className={`${styles.metaChip} ${styles.chipFamily}`}>
            {plant.family}
          </span>

          {hardiness !== null && (
            <span className={`${styles.metaChip} ${styles.chipHardiness}`}>
              ❄ {hardiness}
            </span>
          )}

          {height !== null && (
            <span className={`${styles.metaChip} ${styles.chipHeight}`}>
              ↕ {height}
            </span>
          )}

          {plant.stratum !== null && (
            <span className={`${styles.metaChip} ${styles.chipStratum}`}>
              {plant.stratum}
            </span>
          )}

          {plant.growth_rate !== null && (
            <span className={styles.metaChip}>
              {plant.growth_rate}
            </span>
          )}

          {plant.edibility_rating !== null && plant.edibility_rating > 0 && (
            <span className={`${styles.metaChip} ${styles.chipEdible}`}>
              ● {t('plantDb.filterEdible')} {plant.edibility_rating}/5
            </span>
          )}

          {plant.medicinal_rating !== null && plant.medicinal_rating > 0 && (
            <span className={`${styles.metaChip} ${styles.chipMedicinal}`}>
              ✦ {t('plantDb.filterMedicinal')} {plant.medicinal_rating}/5
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        className={`${styles.favBtn} ${plant.is_favorite ? styles.favBtnActive : ''}`}
        onClick={handleFavClick}
        aria-label={favLabel}
        aria-pressed={plant.is_favorite}
        title={favLabel}
      >
        {plant.is_favorite ? '★' : '☆'}
      </button>
    </div>
  );
}
