import { describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState } from '../scene/defaults'
import { getRectangularZoneCorners } from '../zone-geometry'
import { appendEllipseZoneToDraft, appendRectangleZoneToDraft, appendTextAnnotationToDraft } from './tool-actions'

describe('append helpers', () => {
  it('a rectangle keeps its unturned box and turns about its centre', () => {
    const draft = createDefaultScenePersistedState()
    appendRectangleZoneToDraft(draft, { x: 0, y: 0, width: 4, height: 2 }, 0)
    appendRectangleZoneToDraft(draft, { x: 0, y: 0, width: 4, height: 2 }, 90)
    const [level, turned] = draft.zones
    expect(level?.rotationDeg).toBe(0)
    expect(turned?.rotationDeg).toBe(90)
    expect(turned?.points).toEqual(level?.points)
    const corners = getRectangularZoneCorners(turned!)!
    expect(corners[0]!.x).toBeCloseTo(3)
    expect(corners[0]!.y).toBeCloseTo(-1)
  })

  it('an ellipse keeps its centre and radii and stores the turn', () => {
    const draft = createDefaultScenePersistedState()
    appendEllipseZoneToDraft(draft, { x: 0, y: 0, width: 4, height: 2 }, 0)
    appendEllipseZoneToDraft(draft, { x: 0, y: 0, width: 4, height: 2 }, 30)
    expect(draft.zones.map(zone => zone.rotationDeg)).toEqual([0, 30])
    expect(draft.zones[1]?.points).toEqual([{ x: 2, y: 1 }, { x: 2, y: 1 }])
  })

  it('a note stores null (level with north) or the given angle', () => {
    const draft = createDefaultScenePersistedState()
    appendTextAnnotationToDraft(draft, { x: 1, y: 2 }, 'level', null)
    appendTextAnnotationToDraft(draft, { x: 1, y: 2 }, 'turned', 30)
    expect(draft.annotations.map(note => note.rotationDeg)).toEqual([null, 30])
  })
})
