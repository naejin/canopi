import { describe, expect, it } from 'vitest'
import { SceneViewportPresentation, projectScenePlantLabels } from '../canvas/runtime/renderers/viewport-presentation'
import type { ScenePlantEntity } from '../canvas/runtime/scene'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

const plant: ScenePlantEntity = {
  kind: 'plant', id: 'mint', position: { x: 2, y: 3 }, canonicalName: 'Mentha spicata',
  commonName: 'Mint', color: null, stratum: null, canopySpreadM: 1, rotationDeg: null,
  scale: null, notes: null, plantedDate: null, quantity: null, locked: false, pinnedName: true,
}

function snapshot(pinnedName = true) {
  const input = createTestSceneRendererSnapshot({
    scene: { plants: [{ ...plant, pinnedName }] },
    viewport: { x: 10, y: 20, scale: 20 },
    selectedTargets: [{ kind: 'plant', id: 'mint' }],
  })
  return { ...input, ...projectScenePlantLabels(input) }
}

describe('retained viewport presentation', () => {
  it('translates retained labels on repeated pans without consulting scene geometry again', () => {
    const owner = new SceneViewportPresentation()
    const initial = snapshot()
    owner.setScene(initial)
    expect(owner.current?.plantNameLabels[0]?.screenPoint).toEqual({ x: 50, y: 88.3170731707317 })
    // A pan must only translate the already projected labels.
    Object.defineProperty(initial.scene, 'plants', { get: () => { throw new Error('pan read geometry') } })
    owner.setViewport({ x: 17, y: 13, scale: 20 })
    expect(owner.current?.plantNameLabels[0]?.screenPoint).toEqual({ x: 57, y: 81.3170731707317 })
    owner.setViewport({ x: -2, y: 40, scale: 20 })
    expect(owner.current?.plantNameLabels[0]?.screenPoint).toEqual({ x: 38, y: 108.3170731707317 })
    expect(initial.pinnedPlantNameLabels[0]?.screenPoint).toEqual({ x: 50, y: 86.3170731707317 })
  })

  it('reprojects zoom and replaces selection, pins and localized names with new scene data', () => {
    const owner = new SceneViewportPresentation()
    owner.setScene(snapshot(false))
    expect(owner.current?.snapshot.selectionLabels[0]?.screenPoint).toEqual({ x: 50, y: 86.3170731707317 })
    owner.setViewport({ x: 1, y: 2, scale: 2 })
    expect(owner.current?.snapshot.selectionLabels[0]?.screenPoint).toEqual({ x: 5, y: 13 })
    const next = snapshot()
    const localized = { ...next, localizedCommonNames: new Map([['Mentha spicata', 'Menthe']]) }
    owner.setScene({ ...localized, ...projectScenePlantLabels(localized) })
    expect(owner.current?.snapshot.selectionLabels).toEqual([])
    expect(owner.current?.plantNameLabels[0]?.text).toBe('Menthe')
    owner.setViewport({ x: 0, y: 0, scale: 40 })
    expect(owner.current?.plantNameLabels[0]?.screenPoint).toEqual({ x: 80, y: 129.11475409836066 })
    owner.setScene(createTestSceneRendererSnapshot())
    expect(owner.current?.plantNameLabels).toEqual([])
  })

  it('ignores camera updates before a scene and releases retained data on disposal', () => {
    const owner = new SceneViewportPresentation()
    expect(owner.setViewport({ x: 0, y: 0, scale: 20 })).toBeNull()
    owner.setScene(snapshot())
    owner.dispose()
    expect(owner.current).toBeNull()
    expect(owner.setViewport({ x: 0, y: 0, scale: 20 })).toBeNull()
  })
})
