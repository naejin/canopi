import { beforeEach, describe, expect, it } from 'vitest'
import { selectedObjectIds } from '../state/canvas'
import { CanvasSession } from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import type { CanopiFile } from '../types/design'

const FILE: CanopiFile = {
  version: 1,
  name: 'Session demo',
  description: null,
  location: null,
  north_bearing_deg: 0,
  plant_species_colors: {},
  layers: [
    { name: 'plants', visible: true, locked: false, opacity: 1 },
    { name: 'zones', visible: true, locked: false, opacity: 1 },
    { name: 'annotations', visible: true, locked: false, opacity: 1 },
  ],
  plants: [{
    id: 'plant-1',
    canonical_name: 'Malus domestica',
    common_name: 'Apple',
    color: null,
    position: { x: 10, y: 10 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
  }],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
  created_at: '2026-04-02T00:00:00.000Z',
  updated_at: '2026-04-02T00:00:00.000Z',
  extra: {},
}

describe('CanvasSession selection authority', () => {
  beforeEach(() => {
    selectedObjectIds.value = new Set()
  })

  it('reads selection from the runtime, not the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(FILE)
    runtime.getSceneStore().setSelection(['plant-1'])
    selectedObjectIds.value = new Set(['zone-1'])

    const session = new CanvasSession(runtime)

    expect(session.getSelection()).toEqual(new Set(['plant-1']))
  })

  it('writes selection through the runtime and resyncs the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(FILE)
    const session = new CanvasSession(runtime)

    session.setSelection(['plant-1'])
    expect(runtime.getSceneStore().session.selectedEntityIds).toEqual(new Set(['plant-1']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    session.clearSelection()
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
  })
})
