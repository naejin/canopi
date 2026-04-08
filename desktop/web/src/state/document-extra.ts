const KNOWN_CANOPI_KEYS = new Set([
  'version',
  'name',
  'description',
  'location',
  'north_bearing_deg',
  'plant_species_colors',
  'layers',
  'plants',
  'zones',
  'annotations',
  'consortiums',
  'groups',
  'timeline',
  'budget',
  'budget_currency',
  'created_at',
  'updated_at',
  'extra',
])

/** Extract unknown top-level keys from a raw IPC-deserialized object. */
export function extractExtra(raw: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CANOPI_KEYS.has(key)) {
      extra[key] = raw[key]
    }
  }
  return extra
}
