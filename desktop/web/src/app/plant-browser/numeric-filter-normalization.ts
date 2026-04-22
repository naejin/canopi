import type { DynamicFilter } from '../../types/species'

type NumericRange = readonly [number, number]

function parseFiniteNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function normalizeRange(range: NumericRange | null | undefined): NumericRange | null {
  if (!range) return null
  const [a, b] = range
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  return a < b ? [a, b] : [b, a]
}

function isNoopFullRange(low: number, high: number, range: NumericRange | null): boolean {
  if (!range) return false
  return low <= range[0] && high >= range[1]
}

/**
 * Normalize a numeric dynamic filter and drop no-op or malformed variants.
 */
export function normalizeNumericExtraFilter(
  filter: DynamicFilter,
  range: NumericRange | null | undefined,
): DynamicFilter | null {
  const normalizedRange = normalizeRange(range)

  if (filter.op === 'Between') {
    if (filter.values.length < 2) return null

    const lowRaw = parseFiniteNumber(filter.values[0])
    const highRaw = parseFiniteNumber(filter.values[1])
    if (lowRaw == null || highRaw == null) return null

    const low = Math.min(lowRaw, highRaw)
    const high = Math.max(lowRaw, highRaw)

    if (low === high) return null
    if (isNoopFullRange(low, high, normalizedRange)) return null

    return { ...filter, values: [formatNumber(low), formatNumber(high)] }
  }

  if (filter.op === 'Gte' || filter.op === 'Lte' || filter.op === 'Equals') {
    const value = parseFiniteNumber(filter.values[0])
    if (value == null) return null

    if (normalizedRange) {
      if (filter.op === 'Gte' && value <= normalizedRange[0]) return null
      if (filter.op === 'Lte' && value >= normalizedRange[1]) return null
    }

    return { ...filter, values: [formatNumber(value)] }
  }

  return filter
}
