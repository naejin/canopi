import { t } from '../../i18n';
import { locale } from '../../state/app';
import { toggleFavoriteAction, selectedCanonicalName } from '../../state/plant-db';
import type { SpeciesListItem } from '../../types/species';
import styles from './PlantDb.module.css';

interface Props {
  plant: SpeciesListItem;
}

export function PlantCard({ plant }: Props) {
  void locale.value;

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData('application/json', JSON.stringify({
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
    }));
    e.dataTransfer!.effectAllowed = 'copy';
  };

  const handleClick = () => {
    selectedCanonicalName.value = plant.canonical_name;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
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

  return (
    <div
      className={styles.plantCard}
      draggable={true}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listitem"
      aria-label={plant.canonical_name}
    >
      <span className={styles.cardBotanical}>{plant.canonical_name}</span>
      {plant.common_name !== null && (
        <span className={styles.cardCommon}>{plant.common_name}</span>
      )}
      {plant.family && <span className={styles.cardFamily}>{plant.family}</span>}

      <div className={styles.cardMeta}>
        {plant.stratum !== null && (
          <span className={styles.metaChip}>{plant.stratum}</span>
        )}
        {plant.height_max_m !== null && (
          <span className={styles.metaChip}>{plant.height_max_m}m</span>
        )}
        {plant.hardiness_zone_min !== null && (
          <span className={styles.metaChip}>Z{plant.hardiness_zone_min}</span>
        )}
      </div>

      <div className={styles.cardFavRow}>
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
    </div>
  );
}
