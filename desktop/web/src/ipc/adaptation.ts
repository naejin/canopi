import { invoke } from '@tauri-apps/api/core';
import { plantDbStatus } from '../state/app';

export interface CompatibilityResult {
  species_id: string;
  canonical_name: string;
  common_name: string | null;
  hardiness_min: number | null;
  hardiness_max: number | null;
  is_compatible: boolean;
  /** How many zones the plant is outside the target (0 = compatible). */
  zone_diff: number;
}

export interface ReplacementSuggestion {
  canonical_name: string;
  common_name: string | null;
  hardiness_min: number | null;
  hardiness_max: number | null;
  stratum: string | null;
  height_max_m: number | null;
}

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
  if (isDegraded() || canonicalNames.length === 0) return [];
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
  if (isDegraded()) return [];
  return invoke<ReplacementSuggestion[]>('suggest_replacements', {
    canonicalName,
    targetHardiness,
    limit,
    locale,
  });
}
