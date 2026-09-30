// canvas/runtime/tools/measurement-guide.ts
//
// Owns the Measure tool: a drag draws a line with its length chip and the release keeps it as a measurement guide, selected,
// in one Scene Edit (the drag of tools/zone-drag.ts). A closed Measurements layer draws and adds nothing. The guide-end
// handles and their drag belong to Select (tools/select/guide-ends.ts).

import { createMeasurementGuideDraftMeasurements } from '../measurement-guides'
import type { CanvasTool } from './tool'
import { appendMeasurementGuideToDraft } from './tool-actions'
import { createDragShapeTool, DRAFT_STROKE } from './zone-drag'

export function createMeasurementGuideTool(): CanvasTool {
  return createDragShapeTool({
    id: 'measurement-guide',
    layer: 'measurement-guides',
    editType: 'interaction-measurement-guide',
    shape: (start, end) => ({ kind: 'polyline', points: [start, end], style: DRAFT_STROKE }),
    measure: createMeasurementGuideDraftMeasurements,
    place: (start, end) => (draft) => {
      const id = appendMeasurementGuideToDraft(draft, start, end)
      return id ? { kind: 'measurement-guide', id } : null
    },
  })
}
