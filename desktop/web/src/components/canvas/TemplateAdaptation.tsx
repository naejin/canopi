import { useEffect, useMemo } from 'preact/hooks';
import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import {
  createReplacementSuggestionsController,
  createTemplateAdaptationController,
  type SiteAdaptationBadge,
  type SiteAdaptationReviewRow,
} from '../../app/adaptation';
import styles from './TemplateAdaptation.module.css';

export interface TemplateAdaptationProps {
  /** Canonical names of plants placed on the canvas from the template. */
  canonicalNames: string[];
  /** Target hardiness zone for the user's location. */
  targetHardiness: number;
  /** Called when the user finishes reviewing (accept all / dismiss). */
  onClose: () => void;
  /** Called when the user chooses to replace a plant. */
  onReplace?: (originalName: string, replacementName: string) => void;
}

function badgeClass(status: SiteAdaptationReviewRow['status']): string {
  switch (status) {
    case 'compatible': return styles.badgeCompatible!;
    case 'marginal': return styles.badgeMarginal!;
    case 'incompatible': return styles.badgeIncompatible!;
    default: return styles.badgeUnknown!;
  }
}

function badgeLabel(badge: SiteAdaptationBadge): string {
  if (badge.i18nKey) return t(badge.i18nKey, badge.params);
  return badge.literal ?? '';
}

function PlantRow({
  row,
  targetHardiness,
  onReplace,
}: {
  row: SiteAdaptationReviewRow;
  targetHardiness: number;
  onReplace?: (originalName: string, replacementName: string) => void;
}) {
  // Force re-render on locale change
  void locale.value;

  const suggestions = useMemo(() => createReplacementSuggestionsController(), []);

  useEffect(() => () => suggestions.dispose(), [suggestions]);

  async function handleSuggest() {
    await suggestions.toggle(row.canonicalName, targetHardiness, locale.value);
  }

  return (
    <div class={styles.plantRow}>
      <div class={styles.plantInfo}>
        <p class={styles.plantName}>{row.displayName}</p>
        {row.commonName && (
          <p class={styles.plantCanonical}>{row.canonicalName}</p>
        )}
      </div>
      <span class={badgeClass(row.status)}>
        {badgeLabel(row.badge)}
      </span>
      {row.showReplacementSuggestions && (
        <div class={styles.plantActions}>
          <button
            class={styles.suggestBtn}
            onClick={handleSuggest}
            disabled={suggestions.loading.value}
          >
            {t('adaptation.suggestReplacement')}
          </button>
          {suggestions.expanded.value && (
            <div class={styles.replacements}>
              {suggestions.errorMessage.value ? (
                <p class={styles.noReplacements} role="alert">
                  {suggestions.errorMessage.value}
                </p>
              ) : suggestions.replacementRows.value.length === 0 ? (
                <p class={styles.noReplacements}>
                  {t('adaptation.incompatible')}
                </p>
              ) : (
                suggestions.replacementRows.value.map((replacement) => (
                  <div key={replacement.canonicalName} class={styles.replacementItem}>
                    <span class={styles.replacementName}>
                      {replacement.displayName}
                    </span>
                    <span class={styles.replacementZone}>
                      {replacement.hardinessLabel}
                    </span>
                    {onReplace ? (
                      <button
                        class={styles.replaceBtn}
                        onClick={() =>
                          onReplace(row.canonicalName, replacement.canonicalName)
                        }
                      >
                        {t('adaptation.replacement')}
                      </button>
                    ) : (
                      <button class={styles.keepBtn} disabled>
                        {t('adaptation.keepOriginal')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TemplateAdaptation({
  canonicalNames,
  targetHardiness,
  onClose,
  onReplace,
}: TemplateAdaptationProps) {
  // Force re-render on locale change
  void locale.value;

  const controller = useMemo(() => createTemplateAdaptationController(), []);

  useEffect(() => {
    controller.setRequest(canonicalNames, targetHardiness, locale.value);
  }, [canonicalNames, targetHardiness, controller, locale.value]);

  useEffect(() => () => controller.dispose(), [controller]);

  const summary = controller.summary.value;

  return (
    <div class={styles.overlay} onPointerUp={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div class={styles.modal}>
        <div class={styles.header}>
          <h2 class={styles.title}>{t('adaptation.title')}</h2>
          <button class={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {!controller.errorMessage.value && (
          <p class={styles.summary}>
            {t('adaptation.reviewPlants')} — {summary.compatibleCount}/{summary.totalCount} {t('adaptation.compatible').toLowerCase()}
          </p>
        )}

        {controller.loading.value ? (
          <p class={styles.loading}>…</p>
        ) : controller.errorMessage.value ? (
          <p class={styles.noReplacements} role="alert">{controller.errorMessage.value}</p>
        ) : (
          <div class={styles.plantList}>
            {controller.rows.value.map((row) => (
              <PlantRow
                key={row.canonicalName}
                row={row}
                targetHardiness={targetHardiness}
                onReplace={onReplace}
              />
            ))}
          </div>
        )}

        <div class={styles.actions}>
          <button class={styles.dismissAllBtn} onClick={onClose}>
            {t('adaptation.dismissAll')}
          </button>
          <button class={styles.acceptAllBtn} onClick={onClose}>
            {t('adaptation.acceptAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
