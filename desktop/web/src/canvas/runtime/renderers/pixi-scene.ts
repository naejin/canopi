// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import type { Container, Text } from 'pixi.js'
import { getAnnotationPresentation } from '../annotation-layout'
import { buildPlantPresentationEntries } from '../plant-presentation'
import { getMapTextColor, resolveZoneVisual } from '../scene-visuals'
import type { DraftPresentation } from '../tools/draft'
import type { ViewTransform } from '../view/types'
import { createBillboardLayer, drawPlantGlyph, styleAnnotationText, traceAnnotationMarker } from './billboard-layer'
import { createDraftLayer, type DraftScenePainters } from './draft-layer'
import { cssColorAlpha, pixiPaint, screenPxToWorldPx, toPixiColor } from './scene-paint'
import type { SceneRendererSnapshot } from './scene-types'
import { createWorldLayers, traceZonePath, ZONE_STROKE_PX } from './world-layers'

/** Plant a row's disc: today's 2 px border-box border keeps it at least 4 px across (today's (a4c86d39) plant-spacing-overlay.ts). */
const DOT_GHOST_MIN_RADIUS_PX = 2

/**
 * Retained botanical presentation. The MapLibre custom layer owns the stage,
 * the shared WebGL context and frame submission; it presents each frame here
 * once, with the camera's view and any new scene snapshot, and this graph
 * draws the active tool's draft over it (`draft-layer.ts`). The stage holds,
 * in this order (spec §1.5): the world root (`world-layers.ts`), the
 * billboard root (`billboard-layer.ts`), then the two draft roots.
 */
export interface PixiScenePresentation {
  dispose(): void
  resize(width: number, height: number): void
  /**
   * One frame: the camera's view (the world roots' affine, the visible set, the billboards' anchors, label admission on a
   * scale change) and, when data, selection, hover, style or labels changed, the new snapshot drawn under it. A pan
   * brings no snapshot.
   */
  present(view: ViewTransform, snapshot?: SceneRendererSnapshot): void
  setDraft(draft: DraftPresentation | null): void
}

export interface PixiScenePresentationOptions {
  readonly stage: Container
  readonly createText: () => Text
  readonly viewSize: { width: number; height: number }
  /** Asks the host for a frame when the presentation changed outside a render (a draft chip's font arrived). */
  readonly requestRepaint?: () => void
}

export function createPixiScenePresentation(options: PixiScenePresentationOptions): PixiScenePresentation {
  const { stage, createText, viewSize } = options
  let snapshot: SceneRendererSnapshot | null = null
  const world = createWorldLayers()
  // Rasterize text and tessellate symbols at their readable CSS-pixel size.
  // Tiny world-unit primitives lose detail before the camera enlarges them.
  const billboards = createBillboardLayer({ createText, viewSize })
  // Drafts draw over plants, notes and labels, as the DOM previews did over the canvas.
  const draftLayer = createDraftLayer({
    createText,
    viewSize,
    requestRepaint: options.requestRepaint,
    painters: createDraftScenePainters(() => snapshot),
  })
  stage.addChild(world.root)
  stage.addChild(billboards.root)
  stage.addChild(draftLayer.worldDraftRoot)
  stage.addChild(draftLayer.billboardDraftRoot)

  return {
    dispose() {
      draftLayer.dispose()
      billboards.dispose()
      snapshot = null
    },
    resize(width, height) {
      viewSize.width = width
      viewSize.height = height
      billboards.resize(width, height)
      draftLayer.resize(width, height)
    },
    present(view, next) {
      if (next) snapshot = next
      world.present(view, next)
      billboards.present(view, next)
      draftLayer.setView(view)
    },
    setDraft(draft) {
      draftLayer.setDraft(draft)
    },
  }
}

/**
 * The scene's own drawing code, lent to the draft layer so a placement ghost
 * looks like the object a click would create: zones in world units, plant
 * marks and note text at the local origin in CSS px. Plants are presented
 * with the last scene snapshot's plant context.
 */
export function createDraftScenePainters(getSnapshot: () => SceneRendererSnapshot | null): DraftScenePainters {
  return {
    drawZoneGhost(graphics, zone, scale) {
      // Today's ghost: the zone's fill at a fifth and its stroke, with round ends and no casing.
      const visual = resolveZoneVisual(zone)
      if (!traceZonePath(graphics, zone)) return false
      if (zone.zoneType !== 'line') graphics.fill({ color: toPixiColor(visual.fill), alpha: 0.2 * cssColorAlpha(visual.fill) })
      graphics.stroke({
        ...pixiPaint(visual.stroke),
        width: screenPxToWorldPx(ZONE_STROKE_PX, scale),
        cap: 'round',
        join: 'round',
      })
      return true
    },
    drawPlantGhost(graphics, plant, mark, scale, sizeFrom) {
      const snapshot = getSnapshot()
      if (!snapshot) return false
      // A dot's radius is the presentation at sizeFrom (Plant a row: the source plant's), so the whole row has one size.
      const presented = mark === 'dot' && sizeFrom ? { ...plant, position: sizeFrom } : plant
      const [entry] = buildPlantPresentationEntries([presented], {
        plants: snapshot.scene.plants,
        pixelsPerMetre: scale,
        speciesCache: snapshot.speciesCache,
        plantSpeciesSymbols: snapshot.scene.plantSpeciesSymbols,
        localizedCommonNames: snapshot.localizedCommonNames,
      }, new Set())
      if (!entry) return false
      // Plant a row's look: a disc in the display colour, its 2 px border the same colour, so never under 2 px in radius.
      if (mark === 'dot') graphics.circle(0, 0, Math.max(entry.radiusScreenPx, DOT_GHOST_MIN_RADIUS_PX)).fill({ color: toPixiColor(entry.color) })
      else drawPlantGlyph(graphics.context, entry)
      return true
    },
    drawNoteGhost(text, marker, annotation, scale) {
      if (annotation.annotationType !== 'text') return null
      const { textFrame, textOpacity, markerOpacity, markerPaths, markerStrokePx } =
        getAnnotationPresentation(annotation, scale)
      // The note's own angle; the draft layer turns it with the map.
      styleAnnotationText(text, annotation, textFrame.lineHeightPx, 0)
      // Today's ghost marker has no halo.
      traceAnnotationMarker(marker, markerPaths, { x: 0, y: 0 })
      marker.stroke({ color: toPixiColor(getMapTextColor()), width: markerStrokePx })
      return { textOpacity, markerOpacity }
    },
  }
}
