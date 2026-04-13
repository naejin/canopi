import { t } from '../../i18n';
import { locale } from '../../app/shell/state';
import type { SpeciesUse } from '../../types/species';
import styles from './PlantDetail.module.css';

interface Props {
  uses: SpeciesUse[];
  edibilityRating: number | null;
  medicinalRating: number | null;
  otherUsesRating?: number | null;
}

const MAX_RATING = 5;

interface CategoryGroup {
  labelKey: string;
  nameClass: string | undefined;
  dotClass: string | undefined;
  rating: number | null;
  items: SpeciesUse[];
}

function RatingDots({ rating, dotClass }: { rating: number | null; dotClass: string | undefined }) {
  if (rating === null) return null;
  return (
    <div className={styles.usesRating} aria-label={`${rating}/${MAX_RATING}`}>
      {Array.from({ length: MAX_RATING }, (_, i) => (
        <span
          key={i}
          className={`${styles.usesRatingDot} ${i < rating ? dotClass : ''}`}
        />
      ))}
    </div>
  );
}

export function UsesSection({ uses, edibilityRating, medicinalRating, otherUsesRating }: Props) {
  void locale.value;

  const edibleUses = uses.filter((u) => u.use_category.toLowerCase().includes('edible'));
  const medicinalUses = uses.filter((u) => u.use_category.toLowerCase().includes('medicin'));
  const otherUses = uses.filter(
    (u) =>
      !u.use_category.toLowerCase().includes('edible') &&
      !u.use_category.toLowerCase().includes('medicin'),
  );

  const categories: CategoryGroup[] = [
    { labelKey: 'plantDetail.edible', nameClass: styles.usesCategoryNameEdible, dotClass: styles.usesRatingDotEdible, rating: edibilityRating, items: edibleUses },
    { labelKey: 'plantDetail.medicinal', nameClass: styles.usesCategoryNameMedicinal, dotClass: styles.usesRatingDotMedicinal, rating: medicinalRating, items: medicinalUses },
    { labelKey: 'plantDetail.otherUses', nameClass: '', dotClass: styles.usesRatingDotFilled, rating: otherUsesRating ?? null, items: otherUses },
  ];

  const hasAny = uses.length > 0 || edibilityRating !== null || medicinalRating !== null || (otherUsesRating ?? null) !== null;

  if (!hasAny) {
    return <p className={styles.usesEmpty}>{t('plantDetail.unknown')}</p>;
  }

  return (
    <div>
      {categories.map(({ labelKey, nameClass, dotClass, rating, items }) => {
        if (items.length === 0 && rating === null) return null;
        return (
          <div key={labelKey} className={styles.usesCategory}>
            <div className={styles.usesCategoryHeader}>
              <span className={`${styles.usesCategoryName} ${nameClass}`}>{t(labelKey)}</span>
              <RatingDots rating={rating} dotClass={dotClass} />
            </div>
            {items.length > 0 ? (
              items.map((use, idx) => (
                <p key={idx} className={styles.usesDescription}>
                  {use.use_description ?? use.use_category}
                </p>
              ))
            ) : (
              rating !== null && rating > 0 && (
                <p className={styles.usesDescription}>
                  {t('plantDetail.unknown')}
                </p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
