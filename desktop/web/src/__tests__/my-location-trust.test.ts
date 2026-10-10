// The location trust boundary (canopi-f47t.53; canvas v2 plan section 5, P52 and P53; design check A12).
// A device fix is the user's whereabouts: one session owns it, one module calls the browser's geolocation, and the
// reading (dot, accuracy, time) never reaches a Design, Draft, export, snapshot, log or diagnostics. The policies live
// here, not in frontend-architecture-policies.test.ts, so that file keeps one owner; this file therefore runs the
// path-drift and unused-exemption checks over its own list. The browser half (the saved .canopi, the Draft record and
// the saved-view path carry no fix) is e2e/canvas/my-location.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceMapContributions } from '../app/canvas-map-surface/workspace-map-contributions'
import type { WorkspaceMapContributionSnapshot } from '../app/canvas-map-surface/workspace-map-contribution-adapter'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import type { MapLibreApi, MapLibreMapInstance } from '../maplibre/loader'
import type { UserLocationReading } from '../maplibre/user-location-overlay'
import {
  createTypeScriptSourceGraph,
  discoverTypeScriptSourceGraph,
} from './support/architecture/source-facts'
import {
  collectArchitecturePolicyViolations,
  collectPolicyPathDriftViolations,
  collectUnusedExemptionViolations,
  type ArchitecturePolicy,
} from './support/architecture/policy-harness'

const TEST_SOURCE_PATTERNS = [
  'src/__tests__/**',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
] as const

const P52 = 'P52 only the location button and the Web wiring import the location session'
const P53 = 'P53 only the geolocation module calls watchPosition, getCurrentPosition or clearWatch'

const MY_LOCATION_TRUST_POLICIES = [
  {
    kind: 'confine-importers',
    name: P52,
    targets: ['src/app/my-location/session.ts'],
    allowedFrom: [
      'src/components/canvas/MyLocationButton.tsx',
      'src/web/browser-workspace-map-contribution-adapter.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'forbid-calls',
    name: P53,
    from: ['src/**'],
    exceptFrom: ['src/app/my-location/geolocation.ts', ...TEST_SOURCE_PATTERNS],
    properties: ['watchPosition', 'getCurrentPosition', 'clearWatch'],
  },
] satisfies readonly ArchitecturePolicy[]

function plantedSource(path: string, lines: readonly string[]) {
  return { path, source: lines.join('\n') }
}

let sourceGraphCache: ReturnType<typeof discoverTypeScriptSourceGraph> | null = null

function discoveredSourceGraph() {
  sourceGraphCache ??= discoverTypeScriptSourceGraph(new URL('../', import.meta.url), 'src')
  return sourceGraphCache
}

describe('location trust policies on the real source graph', () => {
  it('hold with no violation', () => {
    expect(collectArchitecturePolicyViolations(discoveredSourceGraph(), MY_LOCATION_TRUST_POLICIES)).toEqual([])
  }, 20_000)

  it('name only existing sources', () => {
    expect(collectPolicyPathDriftViolations(discoveredSourceGraph(), MY_LOCATION_TRUST_POLICIES)).toEqual([])
  }, 20_000)

  it('name only exemptions that excuse a real file', () => {
    expect(collectUnusedExemptionViolations(discoveredSourceGraph(), MY_LOCATION_TRUST_POLICIES, TEST_SOURCE_PATTERNS)).toEqual([])
  }, 20_000)
})

describe('location trust policies on planted sources', () => {
  const SESSION = plantedSource('src/app/my-location/session.ts', ['export function startMyLocation() {}'])

  it('P52 rejects a session importer outside the button, the Web wiring and tests', () => {
    const graph = createTypeScriptSourceGraph([
      SESSION,
      plantedSource('src/components/canvas/MyLocationButton.tsx', ["import { startMyLocation } from '../../app/my-location/session'"]),
      plantedSource('src/web/browser-workspace-map-contribution-adapter.ts', ["import { startMyLocation } from '../app/my-location/session'"]),
      plantedSource('src/app/my-location/session.test.ts', ["import { startMyLocation } from './session'"]),
      plantedSource('src/app/document-session/store.ts', ["import { startMyLocation } from '../my-location/session'"]),
      plantedSource('src/components/panels/ViewsPanel.tsx', ["import type { startMyLocation } from '../../app/my-location/session'"]),
    ])

    expect(collectArchitecturePolicyViolations(graph, MY_LOCATION_TRUST_POLICIES)).toEqual([
      expect.stringMatching(/^\[P52 [^\]]+\] src\/app\/document-session\/store\.ts:1:1 imports src\/app\/my-location\/session\.ts /),
      expect.stringMatching(/^\[P52 [^\]]+\] src\/components\/panels\/ViewsPanel\.tsx:1:1 imports src\/app\/my-location\/session\.ts /),
    ])
  })

  it('P53 rejects a geolocation call outside the geolocation module and tests, through optional chains, ! and brackets', () => {
    const graph = createTypeScriptSourceGraph([
      SESSION,
      plantedSource('src/app/my-location/geolocation.ts', [
        'export const watch = (on: PositionCallback) => navigator.geolocation.watchPosition(on)',
        'export const stop = (id: number) => navigator.geolocation.clearWatch(id)',
      ]),
      plantedSource('src/app/my-location/geolocation.test.ts', ['navigator.geolocation.getCurrentPosition(() => {})']),
      plantedSource('src/app/my-location/follow.ts', [
        'navigator.geolocation.watchPosition(() => {})',
        'globalThis.navigator?.geolocation?.getCurrentPosition(() => {})',
        "geo!['clearWatch'](3)",
        'surface.watch(() => {})',
      ]),
    ])

    expect(collectArchitecturePolicyViolations(graph, MY_LOCATION_TRUST_POLICIES)).toEqual([
      `[${P53}] src/app/my-location/follow.ts:1 calls navigator.geolocation.watchPosition`,
      `[${P53}] src/app/my-location/follow.ts:2 calls globalThis.navigator?.geolocation?.getCurrentPosition`,
      `[${P53}] src/app/my-location/follow.ts:3 calls geo!['clearWatch']`,
    ])
  })
})

/** The fix every trust case plants: its digits must never leave the session's reading. */
const FIX: UserLocationReading = { lon: 12.3456789, lat: 45.6789012, accuracy: 30, timestamp: 1_760_000_000_000, stale: false }
const FIX_DIGITS = '12.3456789'

/** A map whose GeoJSON writes fail the way a validation error can: by echoing the data it was given. */
class FailingSetDataMap implements MapLibreMapInstance {
  readonly sources = new Map<string, { setData(data: unknown): void }>()
  readonly order: string[] = ['basemap-background', 'canopi-shared-scene']
  /** Every write that carried the fix to the map. */
  readonly fixWrites: string[] = []
  jumpTo() {}
  resize() {}
  remove() {}
  on() {}
  off() {}
  addSource(id: string, source: Record<string, unknown>) {
    const text = JSON.stringify(source)
    if (text.includes(FIX_DIGITS)) {
      this.fixWrites.push(`addSource ${id}`)
      throw new Error(`addSource rejected ${id}: ${text}`)
    }
    this.sources.set(id, {
      setData: (data: unknown) => {
        const written = JSON.stringify(data)
        if (written.includes(FIX_DIGITS)) this.fixWrites.push(`setData ${id}`)
        throw new Error(`setData rejected ${id}: ${written}`)
      },
    })
  }
  getSource(id: string) { return this.sources.get(id) }
  removeSource(id: string) { this.sources.delete(id) }
  addLayer(layer: Record<string, unknown>) { this.order.push(String(layer.id)) }
  getLayersOrder() { return [...this.order] }
  moveLayer(id: string, before?: string) {
    const index = this.order.indexOf(id)
    if (index < 0) return
    this.order.splice(index, 1)
    const target = before ? this.order.indexOf(before) : -1
    this.order.splice(target < 0 ? this.order.length : target, 0, id)
  }
  setPaintProperty() {}
  getLayer(id: string) { return this.order.includes(id) ? { id } : undefined }
  removeLayer(id: string) {
    const index = this.order.indexOf(id)
    if (index >= 0) this.order.splice(index, 1)
  }
}

function emptySnapshot(): WorkspaceMapContributionSnapshot {
  const scene = createDefaultScenePersistedState()
  return {
    sessionIdentity: {},
    lidar: [],
    terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
    overlays: { runtime: { getSceneSnapshot: () => scene }, location: { lat: 48, lon: 2 }, hoveredTargets: [], selectedTargets: [], site: null },
  }
}

/** Everything any console method was given, as text (errors with their message and stack). */
function consoleText(spies: readonly ReturnType<typeof vi.spyOn>[]): string {
  const text = (value: unknown): string => {
    if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}\n${text((value as { cause?: unknown }).cause)}`
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
  }
  return spies.flatMap((spy) => spy.mock.calls.flat().map(text)).join('\n')
}

describe('a location reading never reaches a log', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('logs no fix when the dot and accuracy source fail to take it', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
      .map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    const map = new FailingSetDataMap()
    const contributions = new WorkspaceMapContributions({ onFailure: () => {} })
    contributions.attach({ map, maplibre: {} as MapLibreApi, lifetime: { on() {}, off() {}, addCleanup() {} }, isCurrent: () => true })
    contributions.update(emptySnapshot())
    contributions.admitStyle()

    contributions.setUserLocation(FIX)

    expect(map.fixWrites, 'the reading reached the map, and its write failed').not.toEqual([])
    expect(consoleText(spies), 'no console output carries the fix').not.toContain(FIX_DIGITS)
  })
})
