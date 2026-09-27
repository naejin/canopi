import { effect, signal } from '@preact/signals'
import { currentCanvasViewportCommandSurface } from '../../canvas/session'

/**
 * The part of the map the workspace's floating chrome leaves visible. The map
 * fills the window; the title bar, the tool and panel rails, the open dock and
 * the bottom chrome float over it. Each registers here, and this module is the
 * one source of the visible map frame: fitting and temporary focus frame into
 * it (through the camera), status chips centre in it and the rulers start at
 * its left edge (through `--map-inset-*` on the map area), and the map credits
 * fold when the bottom band leaves them too little room. The panel rail on
 * the right also registers the room it has above the chrome under its column
 * (the inspection launcher and the zoom group), so a short window folds its
 * last panels into a More button instead of covering that chrome.
 */
export interface VisibleMapFrame {
  /** The map area's size, in CSS pixels. */
  readonly width: number
  readonly height: number
  /** How far chrome covers each edge of the map area, in CSS pixels. */
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export type MapOccluderSide = 'top' | 'right' | 'bottom' | 'left'

export interface MapOccluderBox {
  readonly rect: DOMRect
  /** The edge it covers; inferred from its shape and place when absent. */
  readonly side?: MapOccluderSide
}

/** The least map width the labelled tool rail may leave between itself and the right chrome. */
export const MIN_VISIBLE_MAP_WIDTH_PX = 360
/**
 * The least room the map credits need on one line between the view chip and
 * the zoom group; with less they fold into MapLibre's (i) button instead of
 * wrapping up under a panel.
 */
export const MAP_ATTRIBUTION_MIN_ROOM_PX = 360

/** The least gap between the panel rail's bottom and the chrome under its column. */
export const PANEL_RAIL_BOTTOM_GAP_PX = 8

const NO_FRAME: VisibleMapFrame = Object.freeze({ width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 })
/** A floating band at least this share of the map's width covers the top or the bottom edge. */
const HORIZONTAL_BAND_SHARE = 0.6
const INSET_PROPERTIES = ['top', 'right', 'bottom', 'left'] as const

export const visibleMapFrame = signal<VisibleMapFrame>(NO_FRAME)
/** Whether the map credits fold into their (i) button (see `MAP_ATTRIBUTION_MIN_ROOM_PX`). */
export const mapAttributionFolded = signal(false)
/**
 * The height the panel rail may take from its top edge before the chrome under
 * its column, in CSS pixels; null when nothing sits under it (see
 * `measurePanelRailRoom`).
 */
export const panelRailRoom = signal<number | null>(null)

/** Pure: how far each registered chrome box covers each edge of the map rectangle. */
export function measureVisibleMapFrame(map: DOMRect, occluders: Iterable<MapOccluderBox>): VisibleMapFrame {
  const edges = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const { rect, side } of occluders) {
    if (rect.width <= 0 || rect.height <= 0) continue
    if (rect.right <= map.left || rect.left >= map.right || rect.bottom <= map.top || rect.top >= map.bottom) continue
    const edge = side ?? inferSide(map, rect)
    const cover = edge === 'top' ? rect.bottom - map.top
      : edge === 'bottom' ? map.bottom - rect.top
        : edge === 'left' ? rect.right - map.left
          : map.right - rect.left
    edges[edge] = Math.max(edges[edge], Math.round(cover))
  }
  return { width: Math.round(map.width), height: Math.round(map.height), ...edges }
}

/**
 * Pure: the free width of the bottom band, between the bottom chrome on the
 * left (the view chip) and on the right (the zoom group), where the map
 * credits sit. The whole map width when no bottom chrome is registered.
 */
export function measureBottomBandRoom(map: DOMRect, occluders: Iterable<MapOccluderBox>): number {
  let left = map.left
  let right = map.right
  const middle = map.left + map.width / 2
  for (const { rect, side } of occluders) {
    if (rect.width <= 0 || rect.height <= 0) continue
    if ((side ?? inferSide(map, rect)) !== 'bottom') continue
    if (rect.left + rect.width / 2 < middle) left = Math.max(left, rect.right)
    else right = Math.min(right, rect.left)
  }
  return Math.round(right - left)
}

/**
 * Pure: the height the panel rail may take from its top edge before the
 * highest chrome under its column (the inspection launcher, the zoom group),
 * less `PANEL_RAIL_BOTTOM_GAP_PX`. Null without a rail or chrome under it.
 * Reads only the rail's top and sides, so the rail's own height cannot feed
 * back into it.
 */
export function measurePanelRailRoom(rail: DOMRect | null, below: Iterable<DOMRect>): number | null {
  if (!rail || rail.width <= 0 || rail.height <= 0) return null
  let floor = Infinity
  for (const rect of below) {
    if (rect.width <= 0 || rect.height <= 0) continue
    if (rect.right <= rail.left || rect.left >= rail.right || rect.top < rail.top) continue
    floor = Math.min(floor, rect.top)
  }
  return floor === Infinity ? null : Math.max(0, Math.floor(floor - PANEL_RAIL_BOTTOM_GAP_PX - rail.top))
}

/**
 * Whether the labelled tool rail, whose right edge would sit
 * `labelledRailEdgePx` from the map's left edge, would leave less than
 * `MIN_VISIBLE_MAP_WIDTH_PX` of map before the right chrome. Reads only the
 * right edge of the frame, so the rail's own width cannot feed back into it.
 */
export function toolRailCrowdsMap(frame: VisibleMapFrame, labelledRailEdgePx: number): boolean {
  if (frame.width <= 0) return false
  return frame.width - frame.right - labelledRailEdgePx < MIN_VISIBLE_MAP_WIDTH_PX
}

function inferSide(map: DOMRect, rect: DOMRect): MapOccluderSide {
  if (rect.width >= map.width * HORIZONTAL_BAND_SHARE) {
    return rect.top + rect.height / 2 < map.top + map.height / 2 ? 'top' : 'bottom'
  }
  return rect.left + rect.width / 2 < map.left + map.width / 2 ? 'left' : 'right'
}

let area: HTMLElement | null = null
const occluders = new Map<HTMLElement, MapOccluderSide | undefined>()
let panelRail: HTMLElement | null = null
const underPanelRail = new Set<HTMLElement>()
let observer: ResizeObserver | null = null
let stopCameraSync: (() => void) | null = null

function recompute(): void {
  if (!area) return
  const map = area.getBoundingClientRect()
  const boxes = [...occluders].map(([element, side]) => ({ rect: element.getBoundingClientRect(), side }))
  const next = measureVisibleMapFrame(map, boxes)
  const folded = map.width > 0 && measureBottomBandRoom(map, boxes) < MAP_ATTRIBUTION_MIN_ROOM_PX
  if (mapAttributionFolded.peek() !== folded) mapAttributionFolded.value = folded
  for (const edge of INSET_PROPERTIES) area.style.setProperty(`--map-inset-${edge}`, `${next[edge]}px`)
  const room = measurePanelRailRoom(
    panelRail?.getBoundingClientRect() ?? null,
    [...underPanelRail].map((element) => element.getBoundingClientRect()),
  )
  if (panelRailRoom.peek() !== room) panelRailRoom.value = room
  const current = visibleMapFrame.peek()
  if (
    current.width !== next.width || current.height !== next.height || current.top !== next.top
    || current.right !== next.right || current.bottom !== next.bottom || current.left !== next.left
  ) visibleMapFrame.value = next
}

function observe(element: HTMLElement): void {
  observer?.observe(element)
}

function startWatching(): void {
  if (typeof ResizeObserver !== 'undefined' && !observer) {
    // The map area is full-bleed, so the window's resize covers it; the
    // observer watches the chrome, whose size changes on its own.
    observer = new ResizeObserver(() => recompute())
    for (const element of [...occluders.keys(), ...underPanelRail]) observer.observe(element)
  }
  window.addEventListener('resize', recompute)
  stopCameraSync = effect(() => {
    const frame = visibleMapFrame.value
    currentCanvasViewportCommandSurface.value?.setFramingInsets({
      top: frame.top,
      right: frame.right,
      bottom: frame.bottom,
      left: frame.left,
    })
  })
}

function stopWatching(): void {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', recompute)
  stopCameraSync?.()
  stopCameraSync = null
}

/** The map area: the element the map fills. One at a time; returns its release. */
export function registerMapArea(element: HTMLElement): () => void {
  if (area && area !== element) releaseArea(area)
  area = element
  startWatching()
  recompute()
  return () => releaseArea(element)
}

function releaseArea(element: HTMLElement): void {
  if (area !== element) return
  for (const edge of INSET_PROPERTIES) element.style.removeProperty(`--map-inset-${edge}`)
  area = null
  stopWatching()
  visibleMapFrame.value = NO_FRAME
  mapAttributionFolded.value = false
  panelRailRoom.value = null
}

/** Floating chrome over the map; returns its release. */
export function registerMapOccluder(element: HTMLElement, side?: MapOccluderSide): () => void {
  occluders.set(element, side)
  observe(element)
  recompute()
  return () => {
    if (!occluders.delete(element)) return
    if (!underPanelRail.has(element)) observer?.unobserve(element)
    recompute()
  }
}

/** The panel rail: a right-edge occluder whose room is measured; returns its release. */
export function registerPanelRail(element: HTMLElement): () => void {
  panelRail = element
  const release = registerMapOccluder(element, 'right')
  return () => {
    if (panelRail === element) panelRail = null
    release()
  }
}

/**
 * Chrome under the panel rail's column (the inspection launcher, the zoom
 * group) that the rail must end above; returns its release.
 */
export function registerUnderPanelRail(element: HTMLElement): () => void {
  underPanelRail.add(element)
  observe(element)
  recompute()
  return () => {
    if (!underPanelRail.delete(element)) return
    if (!occluders.has(element)) observer?.unobserve(element)
    recompute()
  }
}

/**
 * Measures again after chrome moved without changing size, such as the rails
 * when a notice row lowers `--chrome-rail-top`.
 */
export function refreshVisibleMapArea(): void {
  recompute()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopWatching())
}
