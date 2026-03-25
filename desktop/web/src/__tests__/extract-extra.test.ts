/**
 * Tests for extractExtra() — forward-compatibility field preservation.
 *
 * Rust's #[serde(flatten)] produces top-level JSON keys for unknown fields.
 * extractExtra() captures these so they survive the TS round-trip.
 */
import { describe, it, expect } from 'vitest'
import { extractExtra } from '../canvas/serializer'

describe('extractExtra', () => {
  it('returns empty object for known-only keys', () => {
    const raw = {
      version: 1,
      name: 'test',
      description: null,
      location: null,
      north_bearing_deg: 0,
      layers: [],
      plants: [],
      zones: [],
      consortiums: [],
      timeline: [],
      budget: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    expect(extractExtra(raw as any)).toEqual({})
  })

  it('captures unknown top-level keys', () => {
    const raw = {
      version: 1,
      name: 'test',
      future_field: 'hello',
      another_unknown: { nested: true },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const extra = extractExtra(raw as any)
    expect(extra).toEqual({
      future_field: 'hello',
      another_unknown: { nested: true },
    })
  })

  it('does not include known keys in extra', () => {
    const raw = {
      version: 1,
      name: 'test',
      plants: [{ canonical_name: 'x' }],
      custom_key: 42,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const extra = extractExtra(raw as any)
    expect(extra).toEqual({ custom_key: 42 })
    expect('plants' in extra).toBe(false)
    expect('version' in extra).toBe(false)
  })
})
