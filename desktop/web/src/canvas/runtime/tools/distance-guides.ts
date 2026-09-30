// canvas/runtime/tools/distance-guides.ts  (pure)
//
// Owns the plant distance guide as draft shapes: a dashed draft line from a plant to a neighbour with a `measure` chip, as
// today's DOM guide drew it (interaction/plant-drag-distance-overlay.ts: 1.5 px dashed 4 4 over its casing, mono 600 chip).
// The Select move-drag guides the dragged plant to the two nearest plants left behind, by distance then id, through
// ToolScene.nearestPlant (a linear scan, as today); Place plants and the stamps draw their own guide with it.

import type { ScenePlantEntity } from '../scene/types'
import type { ScreenPoint, WorldPoint } from '../view/types'
import { formatMetricDistance } from '../zone-measurements'
import type { DraftShape, DraftStroke } from './draft'
import type { ToolScene } from './tool'

const DISTANCE_GUIDE_STROKE: DraftStroke = Object.freeze({ token: 'draft', widthPx: 1.5, dash: Object.freeze([4, 4]) })
/** Today's move-drag shows this many guides. */
const DRAG_DISTANCE_GUIDES = 2

/** The guide from `start` to `end` with its chip at the middle, or at `label.anchor` moved by `label.offsetPx`. */
export function distanceGuideShapes(
  start: WorldPoint,
  end: WorldPoint,
  text: string,
  label: { readonly anchor?: WorldPoint; readonly offsetPx?: ScreenPoint } = {},
): DraftShape[] {
  return [
    { kind: 'polyline', points: [start, end], style: DISTANCE_GUIDE_STROKE },
    {
      kind: 'label',
      anchor: label.anchor ?? { x: start.x + (end.x - start.x) / 2, y: start.y + (end.y - start.y) / 2 },
      offsetPx: label.offsetPx ?? { x: 0, y: 0 },
      text,
      tone: 'measure',
    },
  ]
}

/** The move-drag's guides from `active` (one of `dragged`) to the nearest plants outside `dragged`. */
export function plantDragDistanceGuideShapes(
  scene: Pick<ToolScene, 'nearestPlant'>,
  active: ScenePlantEntity,
  dragged: ReadonlySet<string>,
): DraftShape[] {
  if (!dragged.has(active.id)) return []
  const excluding = new Set(dragged)
  const shapes: DraftShape[] = []
  for (let index = 0; index < DRAG_DISTANCE_GUIDES; index += 1) {
    const nearest = scene.nearestPlant(active.position, excluding)
    if (!nearest) break
    excluding.add(nearest.plant.id)
    shapes.push(...distanceGuideShapes(active.position, nearest.plant.position, formatMetricDistance(nearest.distanceM)))
  }
  return shapes
}
