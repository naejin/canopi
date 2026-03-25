import { t } from '../../i18n';
import { locale } from '../../state/app';
import { toggleFavoriteAction, selectedCanonicalName } from '../../state/plant-db';
import { plantStampSpecies } from '../../state/canvas';
import { canvasEngine } from '../../canvas/engine';
import type { SpeciesListItem } from '../../types/species';
import styles from './PlantDb.module.css';

interface Props {
  plant: SpeciesListItem;
}

export function PlantRow({ plant }: Props) {
  void locale.value;

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData('text/plain', JSON.stringify({
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
      stratum: plant.stratum,
      width_max_m: plant.width_max_m,
    }));
    e.dataTransfer!.effectAllowed = 'copy';

    // Create a compact drag preview showing the plant name, positioned at cursor.
    // Without this, the browser uses a snapshot of the entire row — too large and
    // positioned inconsistently depending on where the user grabbed.
    const preview = document.createElement('div');
    preview.textContent = plant.common_name || plant.canonical_name;
    Object.assign(preview.style, {
      position: 'absolute',
      top: '-1000px',
      left: '-1000px',
      padding: '4px 10px',
      background: '#2D5F3F',
      color: '#FFFFFF',
      fontSize: '12px',
      fontFamily: 'Inter, sans-serif',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    document.body.appendChild(preview);
    // Position: cursor at top-left of preview with a small offset,
    // so the pill appears below-right of the cursor — the cursor tip
    // stays visible and the preview doesn't obscure the drop target.
    e.dataTransfer!.setDragImage(preview, -12, -12);
    // Clean up after the browser has captured the image
    requestAnimationFrame(() => preview.remove());
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
        className={styles.favBtn}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          plantStampSpecies.value = {
            canonical_name: plant.canonical_name,
            common_name: plant.common_name,
            stratum: plant.stratum,
            width_max_m: plant.width_max_m,
          };
          canvasEngine?.setActiveTool('plant-stamp');
        }}
        aria-label={t('plantDb.setAsStamp')}
        title={t('plantDb.setAsStamp')}
      >
        +
      </button>

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
