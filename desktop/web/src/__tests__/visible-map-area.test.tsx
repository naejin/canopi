import { readFileSync } from 'node:fs'
import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mapAttributionFolded,
  measureBottomBandRoom,
  measureRailRoom,
  measureVisibleMapFrame,
  panelRailRoom,
  refreshVisibleMapArea,
  registerMapArea,
  registerMapOccluder,
  registerRail,
  registerUnderRail,
  toolRailRoom,
  leftChromeCrowdsMap,
  visibleMapFrame,
} from '../app/shell/visible-map-area'
import { setCurrentCanvasSession } from '../canvas/session'
import { SidePanelDock } from '../components/shared/SidePanelDock'
import { InspectionLens } from '../components/canvas/InspectionLens'
import type { CanvasInspectionHandle } from '../canvas/inspection'
import { framingRect } from '../canvas/runtime/view/fit'
import type { ScenePersistedState } from '../canvas/runtime/scene'
import { plantFinderMapMatches, zoomToPlantFinderMatches } from '../app/plant-finder/map-matches'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { createLiveTestCanvasRuntimeHost } from './support/live-canvas-runtime'
import { geoAt } from './support/geo-design'
import { createTestCanvasDocumentSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestView } from './support/test-view'

type Box = { left: number; top: number; width: number; height: number }
const boxes = new Map<Element, Box>()

/** A Design holding one rectangular zone from `from` to `to`, in metres. */
function emptyScene(from: { x: number; y: number }, to: { x: number; y: number }): ScenePersistedState {
  return {
    plantSpeciesColors: {}, plantSpeciesSymbols: {}, plantSpeciesCodes: {},
    layers: [], plants: [], annotations: [], measurementGuides: [], groups: [],
    zones: [{
      kind: 'zone', locked: false, id: 'bed', name: 'bed', zoneType: 'rect', rotationDeg: 0, fillColor: null, notes: null,
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

/** An inspection handle whose lens shows a `frame` preview; its commands are spies. */
function lensView(frame: { readonly width: number; readonly height: number }): CanvasInspectionHandle {
  return {
    state: signal({ point: { x: 0, y: 0 }, scale: 10, zoomPercent: 700, previewAvailable: true, frame, plants: [] }),
    sourceQuad: signal(null),
    inspectAtScreenPoint: vi.fn(), inspectAtWorldPoint: vi.fn(), centerOnCanvas: vi.fn(), panByScreen: vi.fn(), zoomBy: vi.fn(),
    highlightPlant: vi.fn(), focusPlant: vi.fn(), dispose: vi.fn(),
  }
}

/** Measures the lens panel at `left` (read at each measure when a getter), `width` wide or `expandedWidth` once expanded,
 *  420 px tall; every other element keeps its registered box. */
function mockLensRect(lens: { left: number | (() => number); top?: number; width: number; expandedWidth?: number }): void {
  const { left, top = 72, width, expandedWidth = width } = lens
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'SECTION' && this.hasAttribute('data-expanded')) {
      const shownLeft = typeof left === 'function' ? left() : left
      return rect({ left: shownLeft, top, width: this.dataset.expanded === 'true' ? expandedWidth : width, height: 420 })
    }
    return rect(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 })
  })
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

  it('counts the dock on the right edge however wide it is, and the narrow edition\'s bottom sheet on the bottom', () => {
    // The expanded calendar on a 1280 px window: 800 px wide, over 60 % of the map, beside the panel rail.
    const expandedCalendar: Box = { left: 404, top: 72, width: 800, height: 664 }
    const narrowWindow: Box = { left: 0, top: 0, width: 720, height: 800 }
    const sheet: Box = { left: 12, top: 320, width: 696, height: 416 }
    let narrow = false
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-dock-width')) return rect(narrow ? sheet : expandedCalendar)
      return rect(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 })
    })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow && query === '(max-width: 760px)', addEventListener: () => {}, removeEventListener: () => {},
    }))
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      render(<SidePanelDock responsive expanded><p /></SidePanelDock>, container)
      expect(visibleMapFrame.value).toMatchObject({ right: 1280 - 404, bottom: 0 })
      expect(area.style.getPropertyValue('--map-inset-bottom')).toBe('0px')

      render(null, container)
      narrow = true
      boxes.set(area, narrowWindow)
      render(<SidePanelDock responsive><p /></SidePanelDock>, container)
      expect(visibleMapFrame.value).toMatchObject({ right: 0, bottom: 800 - 320 })
    } finally {
      render(null, container)
      container.remove()
      releaseArea()
      vi.unstubAllGlobals()
    }
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

  it('the open inspection lens covers the map\'s left edge, so Home and Fit frame the Design right of it', async () => {
    const view = lensView({ width: 430, height: 390 })
    const surfaces = createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo: () => view }) })
    const setFramingInsets = vi.spyOn(surfaces.commands.viewport, 'setFramingInsets')
    setCurrentCanvasSession(surfaces)
    // The lens panel stands at the tool card's left, under the title bar: 390 px wide, 620 px expanded.
    mockLensRect({ left: 248, width: 390, expandedWidth: 620 })
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const host = element(WINDOW)
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      await act(async () => render(<InspectionLens canvasRef={{ current: host }} />, container))
      expect(visibleMapFrame.value.left).toBe(0)

      await act(async () => container.querySelector<HTMLButtonElement>('[data-inspection-launcher]')!.click())
      expect(visibleMapFrame.value.left).toBe(248 + 390)
      expect(setFramingInsets).toHaveBeenLastCalledWith(expect.objectContaining({ left: 248 + 390 }))

      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand lens"]')!.click())
      refreshVisibleMapArea()
      expect(visibleMapFrame.value.left).toBe(248 + 620)

      await act(async () => render(null, container))
      expect(visibleMapFrame.value.left).toBe(0)
    } finally {
      render(null, container)
      container.remove()
      releaseArea()
    }
  })

  it('on a phone the open inspection lens leaves the map area whole, so the selection chip and credits stay on screen', async () => {
    const view = lensView({ width: 284, height: 284 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo: () => view }) }))
    // A 360 px phone held upright: the panel runs from 68 px to 352 px, nearly the map's whole width.
    mockLensRect({ left: 68, top: 60, width: 284 })
    const area = element({ left: 0, top: 0, width: 360, height: 740 })
    const releaseArea = registerMapArea(area)
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      await act(async () => render(<InspectionLens canvasRef={{ current: element(WINDOW) }} />, container))
      await act(async () => container.querySelector<HTMLButtonElement>('[data-inspection-launcher]')!.click())
      expect(container.querySelector('section[data-expanded]')).not.toBeNull()
      refreshVisibleMapArea()
      expect(visibleMapFrame.value.left).toBe(0)
      expect(area.style.getPropertyValue('--map-inset-left')).toBe('0px')
    } finally {
      render(null, container)
      container.remove()
      releaseArea()
    }
  })

  it.each([
    // An iPad held upright (768 x 1024, no phone layout): the named tool rail, the panel rail, and the compact lens at
    // 248..638 would leave 66 px of map.
    { name: 'a 768 px window', window: { left: 0, top: 0, width: 768, height: 1024 }, right: { left: 704, top: 72, width: 52, height: 420 }, expand: false },
    // Desktop's default window with the dock open: the expanded lens at 248..868 meets the dock at 824.
    { name: 'a 1280 px window beside the open dock', window: WINDOW, right: DOCK, expand: true },
  ])('in $name the open lens, which would leave under 360 px of map, leaves Fit, Home and the chips to the rails', async ({ window: map, right, expand }) => {
    const view = lensView({ width: 390, height: 350 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo: () => view }) }))
    mockLensRect({ left: 248, width: 390, expandedWidth: 620 })
    const area = element(map)
    const releaseArea = registerMapArea(area)
    const releaseRail = registerMapOccluder(element(TOOL_RAIL), 'left')
    const releaseRight = registerMapOccluder(element(right), 'right')
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      await act(async () => render(<InspectionLens canvasRef={{ current: element(map) }} />, container))
      const before = visibleMapFrame.value
      await act(async () => container.querySelector<HTMLButtonElement>('[data-inspection-launcher]')!.click())
      if (expand) await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand lens"]')!.click())
      refreshVisibleMapArea()
      expect(container.querySelector(`section[data-expanded="${expand}"]`)).not.toBeNull()
      expect(visibleMapFrame.value).toEqual(before)
      expect(area.style.getPropertyValue('--map-inset-left')).toBe('236px')
    } finally {
      render(null, container)
      container.remove()
      releaseRight()
      releaseRail()
      releaseArea()
    }
  })

  it.each([
    // Names to icons: the lens moves from 248..638 (198 px of map left) to 76..466 (370 px left), so it starts covering.
    { name: 'names to icons', from: 'named', to: 'icons', before: 236, after: 466 },
    // Icons to names: the lens moves from 76..466 to 248..638, so it stops covering and the selection chip keeps its room.
    { name: 'icons to names', from: 'icons', to: 'named', before: 466, after: 236 },
  ] as const)('in a 900 px window the open lens measures its room again when the tool rail switches $name', async ({ from, to, before, after }) => {
    const view = lensView({ width: 390, height: 350 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo: () => view }) }))
    // The lens stands at the tool card's left: 76 px beside the icon rail, 248 px beside the named rail.
    const rails = { icons: { left: 12, width: 52 }, named: { left: 12, width: 224 } }
    const lensLeft = { icons: 76, named: 248 }
    let shown: 'icons' | 'named' = from
    mockLensRect({ left: () => lensLeft[shown], width: 390 })
    const map = { left: 0, top: 0, width: 900, height: 800 }
    const area = element(map)
    const releaseArea = registerMapArea(area)
    const rail = element({ ...rails[from], top: 72, height: 480 })
    const releaseRail = registerMapOccluder(rail, 'left')
    const releaseRight = registerMapOccluder(element({ left: 836, top: 72, width: 52, height: 420 }), 'right')
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      await act(async () => render(<InspectionLens canvasRef={{ current: element(map) }} />, container))
      await act(async () => container.querySelector<HTMLButtonElement>('[data-inspection-launcher]')!.click())
      refreshVisibleMapArea()
      expect(visibleMapFrame.value.left).toBe(before)

      // The rail switches; its resize recomputes the frame while the lens keeps its size.
      shown = to
      boxes.set(rail, { ...rails[to], top: 72, height: 480 })
      await act(async () => refreshVisibleMapArea())
      refreshVisibleMapArea()
      expect(visibleMapFrame.value.left).toBe(after)
    } finally {
      render(null, container)
      container.remove()
      releaseRight()
      releaseRail()
      releaseArea()
    }
  })

  it('frames temporary focus and Fit to Design inside the visible map area', () => {
    const insets = { top: 60, right: 456, bottom: 56, left: 236 }
    expect(framingRect({ width: 1280, height: 800 }, insets)).toEqual({ x: 236, y: 60, width: 588, height: 684 })

    // The 100 m start frame the camera used to place on a 1280 x 800 screen.
    const camera = createTestView({ screen: { width: 1280, height: 800 }, viewport: { x: 240, y: 0, scale: 8 } })
    camera.navigation.setFramingInsets(insets)
    expect(camera.navigation.focusTemporaryBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { paddingCssPx: 72 })).toBe(true)
    const viewport = camera.viewport()
    // The bounds' centre lands on the visible area's centre, not the window's.
    expect(5 * viewport.scale + viewport.x).toBeCloseTo(236 + 588 / 2)
    expect(5 * viewport.scale + viewport.y).toBeCloseTo(60 + 684 / 2)
    // And the whole bounds fits between the rails and the dock.
    expect(10 * viewport.scale + viewport.x).toBeLessThanOrEqual(1280 - 456 - 72 + 1e-6)
    expect(viewport.x).toBeGreaterThanOrEqual(236 + 72 - 1e-6)

    const scene = emptyScene({ x: 0, y: 0 }, { x: 40, y: 20 })
    camera.setScene(scene)
    camera.navigation.zoomToFit()
    const fitted = camera.viewport()
    const centre = { x: 20 * fitted.scale + fitted.x, y: 10 * fitted.scale + fitted.y }
    expect(centre.x).toBeCloseTo(236 + 588 / 2, 0)
    expect(centre.y).toBeCloseTo(60 + 684 / 2, 0)
  })

  it('falls back to the whole screen when chrome leaves too little map', () => {
    expect(framingRect({ width: 500, height: 800 }, { top: 0, right: 300, bottom: 0, left: 100 }))
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
    // The narrow edition's bottom sheet covers the bottom edge, but it stops above the band and takes none of its room.
    expect(measureBottomBandRoom(rect(narrow), [
      { rect: rect(viewChip), side: 'bottom' },
      { rect: rect({ left: 12, top: 320, width: 696, height: 416 }), side: 'bottom' },
      { rect: rect(narrowZoom), side: 'bottom' },
    ])).toBe(48)

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

  it('a centred bottom notice takes the credits\' room', () => {
    // The credits sit right of the band's middle, beside the zoom group, so a notice centred on the map bounds them on
    // the left: only the room between the notice and the zoom group is theirs.
    const viewChip = { rect: rect({ left: 12, top: 744, width: 280, height: 44 }), side: 'bottom' as const }
    const notice = { rect: rect({ left: 460, top: 748, width: 360, height: 40 }), side: 'bottom' as const }
    expect(measureBottomBandRoom(rect(WINDOW), [viewChip, { rect: rect(ZOOM_GROUP), side: 'bottom' }, notice])).toBe(80)
    // A wide window leaves the credits their one line beside the notice.
    const wide = { left: 0, top: 0, width: 1920, height: 800 }
    expect(measureBottomBandRoom(rect(wide), [
      viewChip,
      { rect: rect({ left: 1540, top: 744, width: 368, height: 44 }), side: 'bottom' },
      { rect: rect({ left: 780, top: 748, width: 360, height: 40 }), side: 'bottom' },
    ])).toBe(400)
  })

  it('the map notice keeps clear of the zoom group\'s published width in the wide layout, rising above the row without room', () => {
    // jsdom has no layout (e2e/canvas/map-notice-layout.spec.ts hit-tests Retry in both engines): the chip's rule must
    // place it from the widths the zoom group and the view chip publish, not from the window's width.
    const css = readFileSync('src/components/panels/Panels.module.css', 'utf8')
    const rule = (name: string) => new RegExp(`\\.${name}\\s*\\{(?<body>[^}]*)\\}`).exec(css)?.groups?.body ?? ''
    expect(rule('basemapFeedback')).toMatch(/var\(--zoom-group-width/)
    expect(rule('basemapFeedback')).toMatch(/var\(--view-chip-width/)
    expect(rule('basemapFeedbackChip')).toMatch(/bottom:\s*clamp\([^;]*100cqw[^;]*--map-notice-row-clearance/)
    expect(css, 'no window-width rule moves the notice').not.toMatch(/@media \(max-width:[^)]*\)\s*\{\s*\.basemapFeedback/)
    // The seam reads the notice's place in the row, not where the chip rose to: framing stays at the row's top.
    const viewChip = { rect: rect({ left: 12, top: 716, width: 280, height: 40 }), side: 'bottom' as const }
    const zoomGroup = { rect: rect({ left: 622, top: 716, width: 390, height: 40 }), side: 'bottom' as const }
    const noticeInRow = { rect: rect({ left: 347, top: 716, width: 330, height: 40 }), side: 'bottom' as const }
    expect(measureVisibleMapFrame(rect({ left: 0, top: 0, width: 1024, height: 768 }), [viewChip, zoomGroup, noticeInRow]).bottom)
      .toBe(52)
  })

  it('measures the room the panel rail has above the chrome under its column', () => {
    // The inspection launcher sits in the rail's column, above the zoom group.
    const launcher = { left: 1228, top: 696, width: 40, height: 40 }
    expect(measureRailRoom(rect(PANEL_RAIL), [rect(ZOOM_GROUP), rect(launcher)])).toBe(696 - 8 - 72)
    // A hidden launcher leaves the zoom group as the floor.
    expect(measureRailRoom(rect(PANEL_RAIL), [rect(ZOOM_GROUP), rect({ left: 0, top: 0, width: 0, height: 0 })]))
      .toBe(744 - 8 - 72)
    // Chrome outside the rail's column, or nothing under it, sets no floor.
    expect(measureRailRoom(rect(PANEL_RAIL), [rect({ left: 12, top: 744, width: 280, height: 44 })])).toBeNull()
    expect(measureRailRoom(rect(PANEL_RAIL), [])).toBeNull()
    expect(measureRailRoom(null, [rect(ZOOM_GROUP)])).toBeNull()
    // A short window (the 1024 x 768 gallery workspace, 480 px of map) leaves less than the rail's 420 px.
    const shortRail = rect({ left: 960, top: 310, width: 52, height: 420 })
    expect(measureRailRoom(shortRail, [rect({ left: 692, top: 672, width: 320, height: 40 })])).toBe(672 - 8 - 310)
  })

  it('measures a chrome resize on the next frame, never inside the observer\'s delivery (WebKit\'s loop error)', () => {
    // Writing --map-inset-* or a rail's room while ResizeObserver delivers resizes chrome it observes (the top chip slot
    // reflows when the tool rail drops its names), which WebKit reports as "ResizeObserver loop completed with
    // undelivered notifications"; measured on the next frame, that resize is an ordinary new observation.
    let deliver: ResizeObserverCallback | null = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { deliver = callback }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const rail = element(TOOL_RAIL)
    const releaseRail = registerRail('tool', rail)
    try {
      expect(area.style.getPropertyValue('--map-inset-left')).toBe('236px')
      boxes.set(rail, { ...TOOL_RAIL, width: 52 })
      deliver!([], {} as ResizeObserver)
      deliver!([], {} as ResizeObserver)
      expect(area.style.getPropertyValue('--map-inset-left'), 'nothing written during the delivery').toBe('236px')
      expect(visibleMapFrame.value.left).toBe(236)
      expect(frames).toHaveLength(1)
      frames.shift()!(0)
      expect(area.style.getPropertyValue('--map-inset-left')).toBe('64px')
      expect(visibleMapFrame.value.left).toBe(64)
    } finally {
      releaseRail()
      releaseArea()
      vi.unstubAllGlobals()
    }
  })

  it('publishes the panel rail room and follows the rail when a notice lowers it', () => {
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const rail = element(PANEL_RAIL)
    const releaseRail = registerRail('panel', rail)
    try {
      expect(panelRailRoom.value).toBeNull()
      const releaseZoom = registerUnderRail('panel', element(ZOOM_GROUP))
      expect(panelRailRoom.value).toBe(744 - 8 - 72)
      // The rail is a right-edge occluder too.
      expect(visibleMapFrame.value.right).toBe(64)

      boxes.set(rail, { ...PANEL_RAIL, top: 120 })
      refreshVisibleMapArea()
      expect(panelRailRoom.value).toBe(744 - 8 - 120)

      releaseZoom()
      expect(panelRailRoom.value).toBeNull()
    } finally {
      releaseRail()
      releaseArea()
    }
    expect(visibleMapFrame.value.right).toBe(0)
  })

  it('publishes the tool rail room above the view chip, apart from the panel rail room', () => {
    const area = element(WINDOW)
    const releaseArea = registerMapArea(area)
    const releaseRail = registerRail('tool', element(TOOL_RAIL))
    try {
      expect(toolRailRoom.value).toBeNull()
      const releaseChip = registerUnderRail('tool', element({ left: 12, top: 744, width: 280, height: 44 }))
      expect(toolRailRoom.value).toBe(744 - 8 - 72)
      expect(panelRailRoom.value).toBeNull()
      // The rail is a left-edge occluder too.
      expect(visibleMapFrame.value.left).toBe(236)
      releaseChip()
      expect(toolRailRoom.value).toBeNull()
    } finally {
      releaseRail()
      releaseArea()
    }
    expect(visibleMapFrame.value.left).toBe(0)
  })

  it('lets the labelled tool rail give way when it would crowd the map', () => {
    // 720 px window with a 380 px dock: names would leave far less than 360 px of map.
    expect(leftChromeCrowdsMap({ width: 720, height: 800, top: 60, right: 456, bottom: 0, left: 236 }, 224)).toBe(true)
    expect(leftChromeCrowdsMap({ width: 1280, height: 800, top: 60, right: 456, bottom: 0, left: 236 }, 224)).toBe(false)
    expect(leftChromeCrowdsMap({ width: 720, height: 800, top: 60, right: 64, bottom: 0, left: 64 }, 224)).toBe(false)
  })


  it('Zoom to them and Fit to Design frame the Design into the visible map area', () => {
    const host = createLiveTestCanvasRuntimeHost({ screen: { width: 1280, height: 800 } })
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
        return host.cameraHost.frames.viewFrame.peek().view.worldToScreen(point)
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
