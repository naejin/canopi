// Shared constants used across canvas and UI layers.
// Keyed by RAW DB values (lowercase) — see CLAUDE.md "Stratum DB values are lowercase".

/** Maps raw DB stratum values to i18n translation keys. */
export const STRATUM_I18N_KEY: Record<string, string> = {
  'emergent': 'filters.stratum_emergent',
  'high':     'filters.stratum_high',
  'low':      'filters.stratum_low',
  'medium':   'filters.stratum_medium',
}
