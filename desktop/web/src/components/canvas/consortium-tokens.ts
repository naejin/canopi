import type { PlacedPlant } from '../../types/design'

function normalizeToken(token: string): string {
  return token.trim().toLowerCase()
}

export function buildPlantLookup(plants: PlacedPlant[]): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const plant of plants) {
    const label = plant.common_name || plant.canonical_name || plant.id
    lookup.set(plant.id, label)
  }
  return lookup
}

export function describePlantToken(token: string, plantLookup: Map<string, string>): string {
  return plantLookup.get(token) ?? token
}

export function formatPlantTokenForEdit(token: string, plantLookup: Map<string, string>): string {
  const label = describePlantToken(token, plantLookup)
  return label === token ? token : `${label} [${token}]`
}

export function resolvePlantTokens(input: string, plants: PlacedPlant[]): string[] {
  const byId = new Map<string, string>()
  const byCanonicalName = new Map<string, string>()
  const byCommonName = new Map<string, string>()

  for (const plant of plants) {
    byId.set(normalizeToken(plant.id), plant.id)
    byCanonicalName.set(normalizeToken(plant.canonical_name), plant.id)
    if (plant.common_name) {
      byCommonName.set(normalizeToken(plant.common_name), plant.id)
    }
  }

  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const idSuffix = token.match(/\[([^\]]+)\]\s*$/)
      if (idSuffix?.[1]) {
        return idSuffix[1].trim()
      }

      const normalized = normalizeToken(token)
      return byId.get(normalized)
        ?? byCommonName.get(normalized)
        ?? byCanonicalName.get(normalized)
        ?? token
    })
}
