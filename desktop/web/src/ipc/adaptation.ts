import { invoke } from '@tauri-apps/api/core';
import { plantDbStatus } from '../app/health/state';
import { plantDbUnavailableMessage } from './plant-db-errors';
import type { CompatibilityResult, ReplacementSuggestion } from '../generated/contracts';

export type { CompatibilityResult, ReplacementSuggestion };

/** Returns true when plant DB is not available — all queries should short-circuit. */
function isDegraded(): boolean {
  return plantDbStatus.value !== 'available';
}

/**
 * Check a batch of species against a target hardiness zone.
 * Returns compatibility results for each species found in the DB.
 */
export async function checkPlantCompatibility(
  canonicalNames: string[],
  targetHardiness: number,
  locale = 'en',
): Promise<CompatibilityResult[]> {
  if (canonicalNames.length === 0) return [];
  if (isDegraded()) throw new Error(plantDbUnavailableMessage(plantDbStatus.value));
  return invoke<CompatibilityResult[]>('check_plant_compatibility', {
    canonicalNames,
    targetHardiness,
    locale,
  });
}

/**
 * Suggest replacement species for an incompatible plant.
 * Finds species with similar characteristics but compatible hardiness.
 */
export async function suggestReplacements(
  canonicalName: string,
  targetHardiness: number,
  limit = 5,
  locale = 'en',
): Promise<ReplacementSuggestion[]> {
  if (isDegraded()) throw new Error(plantDbUnavailableMessage(plantDbStatus.value));
  return invoke<ReplacementSuggestion[]>('suggest_replacements', {
    canonicalName,
    targetHardiness,
    limit,
    locale,
  });
}
