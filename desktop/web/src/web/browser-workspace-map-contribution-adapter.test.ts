import { afterEach, describe, expect, it, vi } from 'vitest'
import { effect, signal } from '@preact/signals'
import { clearPanelOriginTargets, setHoveredPanelTargets } from '../app/panel-targets/presentation'
import { createTestCanvasQuerySurface, type TestPlacement } from '../__tests__/support/canvas-query-surface'
import { createSessionPlane, type SessionPlane } from '../canvas/session-plane'
import { createBrowserWorkspaceMapContributionAdapter } from './browser-workspace-map-contribution-adapter'
import { setCanvasMapBackdrop } from '../canvas/runtime/scene-visuals'

afterEach(clearPanelOriginTargets)

function runtimeWithPlane(
  plane: SessionPlane | null,
  placement?: TestPlacement,
) {
  return createTestCanvasQuerySurface({ placement, sessionPlane: plane })
}

describe('browser workspace map contribution adapter', () => {
  it('returns null without querying scene when no Design exists', () => {
    const adapter = createBrowserWorkspaceMapContributionAdapter({ sessionIdentity: signal({}), hasCurrentDesign: () => false })
    const runtime = runtimeWithPlane(createSessionPlane({ lat: 48, lon: 2 }))
    vi.spyOn(runtime, 'getSceneSnapshot')
    vi.spyOn(runtime, 'sceneHasObjects')
    expect(adapter.read(runtime)).toBeNull()
    expect(runtime.getSceneSnapshot).not.toHaveBeenCalled()
    expect(runtime.sceneHasObjects).not.toHaveBeenCalled()
    expect(adapter.loadTerrainSupport).toBeUndefined()
    expect(adapter.publishViewBounds).toBeUndefined()
  })

  it('returns null until the runtime has a session plane', () => {
    const adapter = createBrowserWorkspaceMapContributionAdapter({ sessionIdentity: signal({}), hasCurrentDesign: () => true })
    expect(adapter.read(runtimeWithPlane(null))).toBeNull()
  })

  it('captures session-bound targets at the session plane origin with explicitly empty LiDAR and terrain', () => {
    const identity = {}
    const adapter = createBrowserWorkspaceMapContributionAdapter({
      sessionIdentity: signal(identity), hasCurrentDesign: () => true,
    })
    setHoveredPanelTargets([{ kind: 'zone', zone_id: 'plot' }])
    const snapshot = adapter.read(runtimeWithPlane(createSessionPlane({ lat: 48, lon: 2 })))!
    expect(snapshot.sessionIdentity).toBe(identity)
    expect(snapshot.lidar).toEqual([])
    expect(snapshot.terrain).toMatchObject({ contoursVisible: false, hillshadeVisible: false })
    expect(snapshot.overlays.location).toEqual({ lat: 48, lon: 2 })
    expect(snapshot.overlays.hoveredTargets).toEqual([{ kind: 'zone', zone_id: 'plot' }])
    expect(snapshot).not.toHaveProperty('designExtentMeters')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.overlays.hoveredTargets[0])).toBe(true)
    clearPanelOriginTargets()
    expect(snapshot.overlays.hoveredTargets).toHaveLength(1)
  })

  it('suppresses panel Target overlays in overview without changing their authority', () => {
    const adapter = createBrowserWorkspaceMapContributionAdapter({
      sessionIdentity: signal({}), hasCurrentDesign: () => true,
    })
    setHoveredPanelTargets([{ kind: 'zone', zone_id: 'plot' }])

    const snapshot = adapter.read(runtimeWithPlane(
      createSessionPlane({ lat: 23, lon: 13 }),
      { x: 0, y: 0, scale: 0.01 },
    ))!

    expect(snapshot.overlays.hoveredTargets).toEqual([])
    clearPanelOriginTargets()
    expect(snapshot.overlays.hoveredTargets).toEqual([])
  })

  it('reads again when the canvas paint changes, so overlays already on the map repaint', () => {
    const adapter = createBrowserWorkspaceMapContributionAdapter({
      sessionIdentity: signal({}), hasCurrentDesign: () => true,
    })
    const runtime = runtimeWithPlane(createSessionPlane({ lat: 48, lon: 2 }))
    let reads = 0
    const stop = effect(() => {
      adapter.read(runtime)
      reads += 1
    })
    try {
      setCanvasMapBackdrop('satellite')
      expect(reads).toBe(2)
    } finally {
      stop()
      setCanvasMapBackdrop('basemap')
    }
  })
})
