import { useSignal, useComputed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import {
  checkPlantCompatibility,
  suggestReplacements,
  type CompatibilityResult,
  type ReplacementSuggestion,
} from '../../ipc/adaptation';
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

type PlantStatus = 'compatible' | 'marginal' | 'incompatible' | 'unknown';

function getStatus(result: CompatibilityResult): PlantStatus {
  if (result.hardiness_min == null && result.hardiness_max == null) return 'unknown';
  if (result.is_compatible && result.zone_diff === 0) return 'compatible';
  if (result.is_compatible) return 'marginal';
  return 'incompatible';
}

function badgeClass(status: PlantStatus): string {
  switch (status) {
    case 'compatible': return styles.badgeCompatible!;
    case 'marginal': return styles.badgeMarginal!;
    case 'incompatible': return styles.badgeIncompatible!;
    default: return styles.badgeUnknown!;
  }
}

function badgeLabel(status: PlantStatus, zoneDiff: number): string {
  switch (status) {
    case 'compatible': return t('adaptation.compatible');
    case 'marginal':
    case 'incompatible':
      return t('adaptation.hardinessWarning', { zones: String(zoneDiff) });
    default: return '?';
  }
}

function PlantRow({
  result,
  targetHardiness,
  onReplace,
}: {
  result: CompatibilityResult;
  targetHardiness: number;
  onReplace?: (originalName: string, replacementName: string) => void;
}) {
  // Force re-render on locale change
  void locale.value;

  const status = getStatus(result);
  const showReplacements = useSignal(false);
  const replacements = useSignal<ReplacementSuggestion[]>([]);
  const replacementError = useSignal<string | null>(null);
  const loadingReplacements = useSignal(false);

  async function handleSuggest() {
    if (showReplacements.value) {
      showReplacements.value = false;
      return;
    }
    loadingReplacements.value = true;
    replacementError.value = null;
    try {
      const suggestions = await suggestReplacements(
        result.canonical_name,
        targetHardiness,
        5,
        locale.value,
      );
      replacements.value = suggestions;
    } catch (caught) {
      replacements.value = [];
      replacementError.value =
        caught instanceof Error ? caught.message : String(caught);
    } finally {
      loadingReplacements.value = false;
      showReplacements.value = true;
    }
  }

  const displayName = result.common_name ?? result.canonical_name;

  return (
    <div class={styles.plantRow}>
      <div class={styles.plantInfo}>
        <p class={styles.plantName}>{displayName}</p>
        {result.common_name && (
          <p class={styles.plantCanonical}>{result.canonical_name}</p>
        )}
      </div>
      <span class={badgeClass(status)}>
        {badgeLabel(status, result.zone_diff)}
      </span>
      {(status === 'incompatible' || status === 'marginal') && (
        <div class={styles.plantActions}>
          <button
            class={styles.suggestBtn}
            onClick={handleSuggest}
            disabled={loadingReplacements.value}
          >
            {t('adaptation.suggestReplacement')}
          </button>
          {showReplacements.value && (
            <div class={styles.replacements}>
              {replacementError.value ? (
                <p class={styles.noReplacements} role="alert">
                  {replacementError.value}
                </p>
              ) : replacements.value.length === 0 ? (
                <p class={styles.noReplacements}>
                  {t('adaptation.incompatible')}
                </p>
              ) : (
                replacements.value.map((r) => (
                  <div key={r.canonical_name} class={styles.replacementItem}>
                    <span class={styles.replacementName}>
                      {r.common_name ?? r.canonical_name}
                    </span>
                    <span class={styles.replacementZone}>
                      {r.hardiness_min != null && r.hardiness_max != null
                        ? `Z${r.hardiness_min}–${r.hardiness_max}`
                        : ''}
                    </span>
                    {onReplace ? (
                      <button
                        class={styles.replaceBtn}
                        onClick={() =>
                          onReplace(result.canonical_name, r.canonical_name)
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

  const results = useSignal<CompatibilityResult[]>([]);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loading.value = true;
    error.value = null;

    checkPlantCompatibility(canonicalNames, targetHardiness, locale.value)
      .then((data) => {
        if (!cancelled) {
          results.value = data;
          loading.value = false;
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          results.value = [];
          error.value = caught instanceof Error ? caught.message : String(caught);
          loading.value = false;
        }
      });

    return () => { cancelled = true; };
  }, [canonicalNames, targetHardiness]);

  const compatibleCount = useComputed(() =>
    results.value.filter((r) => getStatus(r) === 'compatible').length,
  );

  const totalCount = useComputed(() => results.value.length);

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

        {!error.value && (
          <p class={styles.summary}>
            {t('adaptation.reviewPlants')} — {compatibleCount.value}/{totalCount.value} {t('adaptation.compatible').toLowerCase()}
          </p>
        )}

        {loading.value ? (
          <p class={styles.loading}>…</p>
        ) : error.value ? (
          <p class={styles.noReplacements} role="alert">{error.value}</p>
        ) : (
          <div class={styles.plantList}>
            {results.value.map((r) => (
              <PlantRow
                key={r.canonical_name}
                result={r}
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
