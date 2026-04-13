import { t } from '../../i18n';
import { locale } from '../../app/shell/state';
import { selectedCanonicalName } from '../../app/plant-browser';
import type { Relationship } from '../../types/species';
import styles from './PlantDetail.module.css';

interface Props {
  relationships: Relationship[];
}

function relTypeClass(type: string): string | undefined {
  const lower = type.toLowerCase();
  if (lower.includes('companion') || lower.includes('beneficial')) return styles.relTypeCompanion;
  if (lower.includes('antagonist') || lower.includes('harmful')) return styles.relTypeAntagonist;
  return styles.relTypeNeutral;
}

export function RelationshipList({ relationships }: Props) {
  void locale.value;

  if (relationships.length === 0) {
    return <p className={styles.relEmpty}>{t('plantDetail.noRelationships')}</p>;
  }

  return (
    <div role="list">
      {relationships.map((rel) => (
        <div
          key={rel.related_canonical_name}
          className={styles.relRow}
          role="listitem"
          tabIndex={0}
          onClick={() => {
            selectedCanonicalName.value = rel.related_canonical_name;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectedCanonicalName.value = rel.related_canonical_name;
            }
          }}
          aria-label={rel.related_canonical_name}
        >
          <span className={styles.relBotanical}>{rel.related_canonical_name}</span>
          <span className={`${styles.relType} ${relTypeClass(rel.relationship_type)}`}>
            {rel.relationship_type}
          </span>
          <span className={styles.relArrow} aria-hidden="true">›</span>
        </div>
      ))}
    </div>
  );
}
