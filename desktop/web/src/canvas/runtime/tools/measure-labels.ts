// canvas/runtime/tools/measure-labels.ts  (pure)
//
// Owns the zone measurement chips as draft shapes (spec §1.4, label tones): the selected zone's W/H, edge and area chips
// that the ToolHost draws under every tool, and the chips of the shape tools' drafts. The area is `measure`; edges and
// dimensions are `measure-quiet`; an edge shorter than 36 px on screen gets no chip, as today's (a4c86d39) overlay
// (interaction/zone-measurement-overlay.ts). The measurements themselves are zone-measurements.ts's.

import type { SceneDesignObjectSelection } from '../scene/design-object-targets'
import { isSceneObjectGroupMemberTarget } from '../scene/group-members'
import type { ScenePersistedState } from '../scene/types'
import type { WorldPoint } from '../view/types'
import { getRectangularZoneCorners } from '../zone-geometry'
import {
  createEllipticalZoneMeasurements,
  createLinearZoneMeasurements,
  createPolygonalZoneMeasurements,
  createRectangularZoneMeasurements,
  type ZoneMeasurementLabel,
} from '../zone-measurements'
import type { DraftShape } from './draft'

/** An edge chip needs this much edge on screen. */
const MIN_EDGE_LABEL_PX = 36
const NO_OFFSET = Object.freeze({ x: 0, y: 0 })

/** The chips of `labels`, centred on their points; `screenDistance` is ToolView.screenDistance. */
export function measureLabelShapes(
  labels: readonly ZoneMeasurementLabel[],
  screenDistance: (a: WorldPoint, b: WorldPoint) => number,
): DraftShape[] {
  const shapes: DraftShape[] = []
  for (const label of labels) {
    if (label.kind === 'edge' && label.worldStart && label.worldEnd
      && screenDistance(label.worldStart, label.worldEnd) < MIN_EDGE_LABEL_PX) continue
    shapes.push({
      kind: 'label',
      anchor: label.worldPosition,
      offsetPx: NO_OFFSET,
      text: label.text,
      tone: label.kind === 'area' ? 'measure' : 'measure-quiet',
    })
  }
  return shapes
}

/**
 * The measurements of the one selected zone: nothing unless exactly one zone is selected, its layer is visible and no
 * group holds it (today's (a4c86d39) refreshSelectedZoneMeasurements, interaction/zone-drawing-tool.ts).
 */
export function selectedZoneMeasurementLabels(
  scene: Readonly<ScenePersistedState>,
  selection: SceneDesignObjectSelection,
): ZoneMeasurementLabel[] {
  if (selection.length !== 1) return []
  const target = selection[0]!
  if (target.kind !== 'zone') return []
  if (scene.layers.find((layer) => layer.name === 'zones')?.visible === false) return []
  if (scene.groups.some((group) => group.members.some((member) => isSceneObjectGroupMemberTarget(member, target)))) return []
  const zone = scene.zones.find((entry) => entry.id === target.id)
  if (!zone) return []

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    return createEllipticalZoneMeasurements(zone.points[0]!, zone.points[1]!, zone.rotationDeg)
  }
  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return createLinearZoneMeasurements(zone.points[0]!, zone.points[1]!)
  }
  if (zone.zoneType === 'polygon') return createPolygonalZoneMeasurements(zone.points)
  if (zone.zoneType !== 'rect') return []
  return createRectangularZoneMeasurements(getRectangularZoneCorners(zone) ?? zone.points)
}
