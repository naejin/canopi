import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mapAttributionFolded,
  measureBottomBandRoom,
  measureVisibleMapFrame,
  registerMapArea,
  registerMapOccluder,
  toolRailCrowdsMap,
  visibleMapFrame,
} from '../app/shell/visible-map-area'
import { setCurrentCanvasSession } from '../canvas/session'
import { CameraController, cameraFramingRect, fitCameraViewport } from '../canvas/runtime/camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'
import { plantFinderMapMatches, zoomToPlantFinderMatches } from '../app/plant-finder/map-matches'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { createLiveTestCanvasRuntimeHost } from './support/live-canvas-runtime'
import { geoAt } from './support/geo-design'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

type Box = { left: number; top: number; width: number; height: number }
const boxes = new Map<Element, Box>()

/** A Design holding one rectangular zone from `from` to `to`, in metres. */
function emptyScene(from: { x: number; y: number }, to: { x: number; y: number }): ScenePersistedState {
  return {
    plantSpeciesColors: {}, plantSpeciesSymbols: {}, plantSpeciesCodes: {},
    layers: [], plants: [], annotations: [], measurementGuides: [], groups: [], guides: [],
    zones: [{
      kind: 'zone', locked: false, name: 'bed', zoneType: 'rect', rotationDeg: 0, fillColor: null, notes: null,
      points: [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }],
    }],
  }
}

function rect({ left, top, width, height }: Box): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

function element(box: Box): HTMLDivElement {
  const node = document.createElement('div')
  document.body.appendChild(node)
  boxes.set(node, box)
  return node
}

const WINDOW: Box = { left: 0, top: 0, width: 1280, height: 800 }
const TITLE_BAR: Box = { left: 12, top: 10, width: 1256, height: 50 }
const TOOL_RAIL: Box = { left: 12, top: 72, width: 224, height: 480 }
const PANEL_RAIL: Box = { left: 1216, top: 72, width: 52, height: 420 }
const DOCK: Box = { left: 824, top: 72, width: 380, height: 664 }
const ZOOM_GROUP: Box = { left: 900, top: 744, width: 368, height: 44 }

describe('visible map area', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rect(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 })
    })
  })

  afterEach(() => {
    for (const node of boxes.keys()) node.remove()
    boxes.clear()
    vi.restoreAllMocks()
    setCurrentCanvasSession(null)
  })

  it('measures the map left visible by the title bar, rails, dock and bottom chrome', () => {
    const frame = measureVisibleMapFrame(rect(WINDOW), [
      { rect: rect(TITLE_BAR) },
      { rect: rect(TOOL_RAIL) },
      { rect: rect(PANEL_RAIL) },
      { rect: rect(DOCK) },
      { rect: rect(ZOOM_GROUP), side: 'bottom' },
      // A hidden occluder takes no room.
      { rect: rect({ left: 0, top: 0, width: 0, height: 0 }) },
    ])
    expect(frame).toEqual({ width: 1280, height: 800, top: 60, right: 456, bottom: 56, left: 236 })
  })

  it('treats a full-width dock at the bottom (the phone sheet) as a bottom edge', () => {
    const sheet = rect({ left: 12, top: 380, width: 1256, height: 356 })
    expect(measureVisibleMapFrame(rect(WINDOW), [{ rect: sheet }])).toMatchObject({ right: 0, bottom: 420 })
  })

  it('publishes the frame as CSS insets on the map area and hands it to the camera', async () => {
    const surfaces = createTestCanvasRuntimeSurfaces()
    const setFramingInsets = vi.spyOn(surfaces.commands.viewport, 'setFramingInsets')
    setCurrentCanvasSession(surfaces)
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const releaseRail = registerMapOccluder(element(TOOL_RAIL))
    const releaseDock = registerMapOccluder(element(DOCK))
    try {
      expect(visibleMapFrame.value).toMatchObject({ left: 236, right: 456 })
      expect(area.style.getPropertyValue('--map-inset-left')).toBe('236px')
      expect(area.style.getPropertyValue('--map-inset-right')).toBe('456px')
      expect(setFramingInsets).toHaveBeenLastCalledWith({ top: 0, right: 456, bottom: 0, left: 236 })

      // Closing the dock gives its room back.
      releaseDock()
      expect(visibleMapFrame.value.right).toBe(0)
      expect(setFramingInsets).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 0, left: 236 })
    } finally {
      releaseRail()
      releaseArea()
    }
    expect(area.style.getPropertyValue('--map-inset-left')).toBe('')
  })

  it('frames temporary focus and Fit to Design inside the visible map area', () => {
    const insets = { top: 60, right: 456, bottom: 56, left: 236 }
    expect(cameraFramingRect({ width: 1280, height: 800 }, insets)).toEqual({ x: 236, y: 60, width: 588, height: 684 })

    const camera = new CameraController()
    camera.initialize({ width: 1280, height: 800 })
    camera.setFrameInsets(insets)
    expect(camera.focusTemporaryBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { paddingCssPx: 72 })).toBe(true)
    const viewport = camera.viewport
    // The bounds' centre lands on the visible area's centre, not the window's.
    expect(5 * viewport.scale + viewport.x).toBeCloseTo(236 + 588 / 2)
    expect(5 * viewport.scale + viewport.y).toBeCloseTo(60 + 684 / 2)
    // And the whole bounds fits between the rails and the dock.
    expect(10 * viewport.scale + viewport.x).toBeLessThanOrEqual(1280 - 456 - 72 + 1e-6)
    expect(viewport.x).toBeGreaterThanOrEqual(236 + 72 - 1e-6)

    const fitted = fitCameraViewport(camera.snapshot.peek(), emptyScene({ x: 0, y: 0 }, { x: 40, y: 20 }), {}, insets)
    const centre = { x: 20 * fitted.scale + fitted.x, y: 10 * fitted.scale + fitted.y }
    expect(centre.x).toBeCloseTo(236 + 588 / 2, 0)
    expect(centre.y).toBeCloseTo(60 + 684 / 2, 0)
  })

  it('falls back to the whole screen when chrome leaves too little map', () => {
    expect(cameraFramingRect({ width: 500, height: 800 }, { top: 0, right: 300, bottom: 0, left: 100 }))
      .toEqual({ x: 0, y: 0, width: 500, height: 800 })
  })

  it('folds the map credits when the bottom band between the view chip and zoom group is narrow', () => {
    const viewChip = { left: 12, top: 744, width: 280, height: 44 }
    const narrow = { left: 0, top: 0, width: 720, height: 800 }
    // 720 px window: the zoom group starts 48 px after the view chip ends.
    const narrowZoom = { left: 340, top: 744, width: 368, height: 44 }
    expect(measureBottomBandRoom(rect(narrow), [
      { rect: rect(viewChip), side: 'bottom' },
      { rect: rect(narrowZoom), side: 'bottom' },
      { rect: rect({ left: 270, top: 72, width: 380, height: 664 }) },
    ])).toBe(48)
    expect(measureBottomBandRoom(rect(WINDOW), [
      { rect: rect(viewChip), side: 'bottom' },
      { rect: rect(ZOOM_GROUP), side: 'bottom' },
    ])).toBe(608)
    expect(measureBottomBandRoom(rect(WINDOW), [])).toBe(1280)

    const area = element(narrow)
    const releaseArea = registerMapArea(area)
    const releaseChip = registerMapOccluder(element(viewChip), 'bottom')
    const zoom = element(narrowZoom)
    const releaseZoom = registerMapOccluder(zoom, 'bottom')
    try {
      expect(mapAttributionFolded.value).toBe(true)
      // A wide window has room for the credits on one line.
      boxes.set(area, WINDOW)
      boxes.set(zoom, ZOOM_GROUP)
      window.dispatchEvent(new Event('resize'))
      expect(mapAttributionFolded.value).toBe(false)
    } finally {
      releaseZoom()
      releaseChip()
      releaseArea()
    }
    expect(mapAttributionFolded.value).toBe(false)
  })

  it('lets the labelled tool rail give way when it would crowd the map', () => {
    // 720 px window with a 380 px dock: names would leave far less than 360 px of map.
    expect(toolRailCrowdsMap({ width: 720, height: 800, top: 60, right: 456, bottom: 0, left: 236 }, 224)).toBe(true)
    expect(toolRailCrowdsMap({ width: 1280, height: 800, top: 60, right: 456, bottom: 0, left: 236 }, 224)).toBe(false)
    expect(toolRailCrowdsMap({ width: 720, height: 800, top: 60, right: 64, bottom: 0, left: 64 }, 224)).toBe(false)
  })


  it('Zoom to them and Fit to Design frame the Design into the visible map area', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1280, height: 800 })
    const host = createLiveTestCanvasRuntimeHost({ camera })
    const at = (x: number, y: number) => geoAt(x, y, { lon: 0, lat: 0 })
    const plant = (id: string, x: number, y: number, canonical: string): CanopiFile['plants'][number] => ({
      id, canonical_name: canonical, common_name: null, color: null, position: at(x, y), rotation: null,
      scale: null, notes: null, planted_date: null, quantity: 1, locked: false,
    })
    try {
      host.surfaces.documents.loadDocument({
        version: CURRENT_CANOPI_FILE_VERSION, name: 'Orchard', description: null, plant_species_colors: {},
        layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
        plants: [plant('a', 0, 0, 'Malus domestica'), plant('b', 40, 30, 'Malus domestica'), plant('c', 200, 200, 'Pyrus communis')],
        zones: [], annotations: [], consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
        created_at: '2026-04-02T00:00:00.000Z', updated_at: '2026-04-02T00:00:00.000Z', extra: {},
      })
      setCurrentCanvasSession(host.surfaces)
      host.surfaces.commands.viewport.setFramingInsets({ top: 60, right: 456, bottom: 56, left: 236 })
      const visibleCentre = { x: 236 + 588 / 2, y: 60 + 684 / 2 }
      const onScreen = (x: number, y: number) => {
        const point = host.surfaces.queries.sessionPlane.value!.toPlane(at(x, y))
        return camera.worldToScreen(point)
      }

      plantFinderMapMatches.value = { query: 'pomm', canonicalNames: ['Malus domestica'] }
      expect(zoomToPlantFinderMatches()).toBe(true)
      const a = onScreen(0, 0)
      const b = onScreen(40, 30)
      expect((a.x + b.x) / 2).toBeCloseTo(visibleCentre.x, 0)
      expect((a.y + b.y) / 2).toBeCloseTo(visibleCentre.y, 0)
      for (const point of [a, b]) {
        expect(point.x).toBeGreaterThan(236)
        expect(point.x).toBeLessThan(1280 - 456)
      }

      host.surfaces.commands.viewport.zoomToFit()
      for (const point of [onScreen(0, 0), onScreen(200, 200)]) {
        expect(point.x).toBeGreaterThan(236)
        expect(point.x).toBeLessThan(1280 - 456)
        expect(point.y).toBeGreaterThan(60)
        expect(point.y).toBeLessThan(800 - 56)
      }
    } finally {
      plantFinderMapMatches.value = null
      void host.destroy()
    }
  })
})
