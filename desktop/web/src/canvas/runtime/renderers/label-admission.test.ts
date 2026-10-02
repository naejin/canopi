import { describe, expect, it } from 'vitest'
import { createTestRendererView, createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import type { ScenePlantEntity } from '../scene'
import type { PlantNameLabel, SelectionLabel } from '../selection-labels'
import { LabelAdmission } from './label-admission'

const plant: ScenePlantEntity = {
  kind: 'plant', id: 'mint', position: { x: 2, y: 3 }, canonicalName: 'Mentha spicata',
  commonName: 'Mint', color: null, stratum: null, canopySpreadM: 1, rotationDeg: null,
  notes: null, plantedDate: null, quantity: null, locked: false, pinnedName: true,
}

function snapshot(pinnedName = true, localizedCommonNames: [string, string][] = []) {
  return createTestSceneRendererSnapshot({
    scene: { plants: [{ ...plant, pinnedName }] },
    selectedTargets: [{ kind: 'plant', id: 'mint' }],
    localizedCommonNames: new Map(localizedCommonNames),
  })
}

/** Where a label lands under the view: its anchor projected, plus its offset. */
function onScreen(label: PlantNameLabel | SelectionLabel, viewport: { x: number; y: number; scale: number }) {
  const at = createTestRendererView(viewport).worldToScreen(label.anchor)
  return { x: at.x + label.offsetPx.x, y: at.y + label.offsetPx.y }
}

describe('label admission', () => {
  it('a pan keeps the admitted labels without reading scene geometry, and they move with their anchors', () => {
    const admission = new LabelAdmission()
    const initial = snapshot()
    admission.setScene(initial)
    const admitted = admission.admit(20)!
    const [name] = admitted.plantNameLabels
    expect(name?.anchor).toEqual({ x: 2, y: 3 })
    for (const [viewport, expected] of [
      [{ x: 10, y: 20, scale: 20 }, { x: 50, y: 88.3170731707317 }],
      [{ x: 17, y: 13, scale: 20 }, { x: 57, y: 81.3170731707317 }],
      [{ x: -2, y: 40, scale: 20 }, { x: 38, y: 108.3170731707317 }],
    ] as const) {
      expect(onScreen(name!, viewport).x).toBeCloseTo(expected.x, 6)
      expect(onScreen(name!, viewport).y).toBeCloseTo(expected.y, 6)
    }
    // A pan admits nothing again: the scene's geometry is not read.
    Object.defineProperty(initial.scene, 'plants', { get: () => { throw new Error('pan read geometry') } })
    expect(admission.admit(20)).toBe(admitted)
  })

  it('a scale change admits again, and a new scene replaces selection, pins and localized names', () => {
    const admission = new LabelAdmission()
    admission.setScene(snapshot(false))
    const [selection] = admission.admit(20)!.selectionLabels
    expect(onScreen(selection!, { x: 10, y: 20, scale: 20 }).y).toBeCloseTo(86.3170731707317, 6)
    const [zoomed] = admission.admit(2)!.selectionLabels
    expect(onScreen(zoomed!, { x: 1, y: 2, scale: 2 })).toEqual({ x: 5, y: 13 })
    admission.setScene(snapshot(true, [['Mentha spicata', 'Menthe']]))
    expect(admission.admit(2)!.selectionLabels).toEqual([])
    const [name] = admission.admit(40)!.plantNameLabels
    expect(name?.text).toBe('Menthe')
    expect(onScreen(name!, { x: 0, y: 0, scale: 40 }).y).toBeCloseTo(129.11475409836066, 6)
    admission.setScene(createTestSceneRendererSnapshot())
    expect(admission.admit(40)!.plantNameLabels).toEqual([])
  })

  it('admits nothing before a scene or after disposal', () => {
    const admission = new LabelAdmission()
    expect(admission.admit(20)).toBeNull()
    admission.setScene(snapshot())
    expect(admission.admit(20)).not.toBeNull()
    admission.dispose()
    expect(admission.current).toBeNull()
    expect(admission.admit(20)).toBeNull()
  })
})
