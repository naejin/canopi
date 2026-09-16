import { afterEach, describe, expect, it, vi } from 'vitest'
import { newDesignSpatialFrame } from '../spatial-frame'
import { signal } from '@preact/signals'
import { clearPanelOriginTargets, setHoveredPanelTargets } from '../app/panel-targets/presentation'
import { createTestCanvasQuerySurface } from '../__tests__/support/canvas-query-surface'
import { createBrowserWorkspaceMapContributionAdapter } from './browser-workspace-map-contribution-adapter'

afterEach(clearPanelOriginTargets)

describe('browser workspace map contribution adapter', () => {
  it('returns null without querying scene or metadata when no Design exists', () => {
    const readMetadata = vi.fn()
    const adapter = createBrowserWorkspaceMapContributionAdapter({ sessionIdentity: signal({}), hasCurrentDesign: () => false, readMetadata })
    const runtime = createTestCanvasQuerySurface()
    vi.spyOn(runtime, 'getSceneSnapshot')
    vi.spyOn(runtime, 'getScenePhysicalExtentMeters')
    expect(adapter.read(runtime)).toBeNull()
    expect(readMetadata).not.toHaveBeenCalled()
    expect(runtime.getSceneSnapshot).not.toHaveBeenCalled()
    expect(runtime.getScenePhysicalExtentMeters).not.toHaveBeenCalled()
    expect(adapter.loadTerrainSupport).toBeUndefined()
    expect(adapter.publishViewBounds).toBeUndefined()
  })

  it('captures session-bound targets with explicitly empty LiDAR and terrain', () => {
    const identity = {}
    const adapter = createBrowserWorkspaceMapContributionAdapter({
      sessionIdentity: signal(identity), hasCurrentDesign: () => true,
      readMetadata: () => ({ spatialFrame: { ...newDesignSpatialFrame(), anchor_latitude_deg: 48, anchor_longitude_deg: 2, north_bearing_deg: 12, placement_status: 'confirmed' } }),
    })
    setHoveredPanelTargets([{ kind: 'zone', zone_name: 'plot' }])
    const snapshot = adapter.read(createTestCanvasQuerySurface())!
    expect(snapshot.sessionIdentity).toBe(identity)
    expect(snapshot.lidar).toEqual([])
    expect(snapshot.terrain).toMatchObject({ contoursVisible: false, hillshadeVisible: false })
    expect(snapshot.overlays.location).toEqual({ lat: 48, lon: 2 })
    expect(snapshot.overlays.hoveredTargets).toEqual([{ kind: 'zone', zone_name: 'plot' }])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.overlays.hoveredTargets[0])).toBe(true)
    clearPanelOriginTargets()
    expect(snapshot.overlays.hoveredTargets).toHaveLength(1)
  })
})
