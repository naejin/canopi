// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm the Object or saved stamp, and the stamp rotation describe.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import { selectSavedObjectStampSourceForTests } from '../canvas/saved-object-stamp-source'
import { selectedObjectIds, type CanvasToolGuidance } from '../canvas/session-state'
import { snapToGridEnabled } from '../app/canvas-settings/signals'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import type { SceneInteractionEventHarness } from './support/scene-interaction-events'
import {
  createInteractionDeps,
  makeMeasurementGuide,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('ignores Measurement Guides in Object Stamp sampling and placement', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 20, y: 40 }, { x: 120, y: 40 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 60, y: 40 }, { button: 0 })
    events.pointerMove({ x: 150, y: 90 }, { button: 0 })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })

    expect(store.persisted.measurementGuides).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(0)
    expect(store.persisted.zones).toHaveLength(0)
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('samples a placed plant with Object Stamp and places anchored clones', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'triangle',
        stratum: 'high',
        canopySpreadM: 4,
        position: { x: 50, y: 60 },
        rotationDeg: 15,
        notes: 'Source plant',
        plantedDate: '2026-02-01',
        quantity: 2,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 54, y: 63 }, { button: 0 })
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(2)
    const clone = store.persisted.plants[1]!
    expect(clone.id).not.toBe('plant-1')
    expect(clone).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'triangle',
      stratum: 'high',
      canopySpreadM: 4,
      position: { x: 96, y: 117 },
      rotationDeg: 15,
      notes: 'Source plant',
      plantedDate: '2026-02-01',
      quantity: 2,
    })
    expect(selectedObjectIds.value).toEqual(new Set([clone.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    session.dispose()
  })

  it('snaps Object Stamp placement by the sampled plant anchor', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    // Screen (44, 44) -> world (11, 11), so the sampled anchor is +1,+1 from the plant position.
    events.pointerDown({ x: 44, y: 44 }, { button: 0 })
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    events.pointerDown({ x: 93, y: 107 }, { button: 0 })

    expect(store.persisted.plants[1]?.position).toEqual({ x: 24, y: 24 })
    session.dispose()
  })

  it('clears loaded Object Stamp source and returns to select on Escape', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.keyDown({ key: 'Escape' })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(setTool).toHaveBeenCalledWith('select')
    expect(store.persisted.plants).toHaveLength(1)
    session.dispose()
  })

  it('clears loaded Object Stamp source when changing tools', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    session.setTool('select')
    session.setTool('object-stamp')
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    session.dispose()
  })

  it('clears loaded Object Stamp preview on session dispose', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 90, y: 90 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    session.dispose()

    expect(preview?.isConnected).toBe(false)
  })

  it('blocks Object Stamp sampling and placement for locked or hidden plant sources', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      const plant = draft.plants.find((entry) => entry.id === 'plant-1')
      if (plant) plant.locked = false
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.visible = false
    })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('samples a zone with Object Stamp and places anchored collision-safe clones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          id: 'Kitchen bed', name: 'Kitchen bed',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 10, y: 20 },
            { x: 50, y: 20 },
            { x: 50, y: 60 },
            { x: 10, y: 60 },
          ],
          fillColor: '#A06B1F',
          notes: 'Annuals',
        },
        {
          kind: 'zone',
          locked: false,
          id: 'Kitchen bed copy', name: 'Kitchen bed copy',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 200, y: 200 },
            { x: 220, y: 200 },
            { x: 220, y: 220 },
            { x: 200, y: 220 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(2)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 120, y: 150 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 120, y: 150 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(3)
    const clone = store.persisted.zones[2]!
    expect(clone).toMatchObject({
      name: 'Kitchen bed',
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 120, y: 140 },
        { x: 160, y: 140 },
        { x: 160, y: 180 },
        { x: 120, y: 180 },
      ],
      fillColor: '#A06B1F',
      notes: 'Annuals',
    })
    expect(selectedObjectIds.value).toEqual(new Set([clone.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    session.dispose()
  })

  it('samples a linear zone with Object Stamp and places anchored clones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'Hedgerow', name: 'Hedgerow',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 20 },
          { x: 50, y: 60 },
        ],
        fillColor: '#A06B1F',
        notes: 'Boundary',
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 120, y: 150 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    // The preview is the stamp itself: the line zone's ghost under the pointer.
    expect(preview?.querySelector('[data-saved-object-stamp-part="zone"]')?.tagName).toBe('polyline')

    events.pointerDown({ x: 120, y: 150 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.zones[1]).toMatchObject({
      name: 'Hedgerow',
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 110, y: 140 },
        { x: 150, y: 180 },
      ],
      fillColor: '#A06B1F',
      notes: 'Boundary',
    })
    expect(selectedObjectIds.value).toEqual(new Set([store.persisted.zones[1]!.id]))
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    session.dispose()
  })

  it('samples an annotation with Object Stamp and places anchored clones with fresh ids', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 20, y: 30 },
        text: 'Guild note',
        fontSize: 20,
        rotationDeg: 12,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 26, y: 36 }, { button: 0 })
    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 100, y: 110 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')
    expect(preview?.querySelector('[data-saved-object-stamp-part="annotation"], [data-saved-object-stamp-part="annotation-marker"]')).not.toBeNull()

    events.pointerDown({ x: 100, y: 110 }, { button: 0 })

    expect(store.persisted.annotations).toHaveLength(2)
    const clone = store.persisted.annotations[1]!
    expect(clone.id).not.toBe('annotation-1')
    expect(clone).toMatchObject({
      annotationType: 'text',
      position: { x: 94, y: 104 },
      text: 'Guild note',
      fontSize: 20,
      rotationDeg: 12,
    })
    expect(selectedObjectIds.value).toEqual(new Set([clone.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    session.dispose()
  })

  it('snaps Object Stamp placement by the sampled annotation anchor', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 10, y: 10 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    // Screen (44, 44) -> world (11, 11), so the sampled anchor is +1,+1 from the annotation position.
    events.pointerDown({ x: 44, y: 44 }, { button: 0 })
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    events.pointerDown({ x: 93, y: 107 }, { button: 0 })

    expect(store.persisted.annotations[1]?.position).toEqual({ x: 24, y: 24 })
    session.dispose()
  })

  it('preserves elliptical zone radii when stamping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'Oval bed', name: 'Oval bed',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 60 },
          { x: 20, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 70, y: 60 }, { button: 0 })
    events.pointerDown({ x: 100, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.zones[1]).toMatchObject({
      name: 'Oval bed',
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 80, y: 100 },
        { x: 20, y: 10 },
      ],
    })
    session.dispose()
  })

  it('blocks Object Stamp sampling and placement for locked or hidden zone and annotation sources', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        id: 'Kitchen bed', name: 'Kitchen bed',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
          { x: 10, y: 50 },
        ],
        fillColor: null,
        notes: null,
        locked: false,
      }]
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 100, y: 30 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
        locked: false,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.zones = draft.zones.map((zone) =>
        zone.id === 'Kitchen bed' ? { ...zone, locked: true } : zone,
      )
    })
    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.zones = draft.zones.map((zone) =>
        zone.id === 'Kitchen bed' ? { ...zone, locked: false } : zone,
      )
    })
    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = false
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(1)

    session.setTool('select')
    session.setTool('object-stamp')
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = true
    })

    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) =>
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation,
      )
    })
    events.pointerDown({ x: 104, y: 34 }, { button: 0 })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })
    expect(store.persisted.annotations).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) =>
        annotation.id === 'annotation-1' ? { ...annotation, locked: false } : annotation,
      )
    })
    events.pointerDown({ x: 104, y: 34 }, { button: 0 })
    store.updatePersisted((draft) => {
      const annotationsLayer = draft.layers.find((layer) => layer.name === 'annotations')
      if (annotationsLayer) annotationsLayer.locked = true
    })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })

    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('samples an object group with Object Stamp and places cloned members with remapped group membership', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        stratum: 'high',
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: 15,
        notes: 'Tree',
        plantedDate: null,
        quantity: 1,
      }]
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'Kitchen bed', name: 'Kitchen bed',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 50 },
          { x: 10, y: 50 },
        ],
        fillColor: '#A06B1F',
        notes: 'Bed',
      }]
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 60, y: 30 },
        text: 'Guild',
        fontSize: 20,
        rotationDeg: 10,
      }]
      draft.groups = [{
        kind: 'group',
        locked: false,
        id: 'group-1',
        name: 'Guild unit',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'Kitchen bed' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(2)
    expect(store.persisted.plants).toHaveLength(2)
    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.annotations).toHaveLength(2)

    const clonePlant = store.persisted.plants[1]!
    const cloneZone = store.persisted.zones[1]!
    const cloneAnnotation = store.persisted.annotations[1]!
    const cloneGroup = store.persisted.groups[1]!

    expect(clonePlant.id).not.toBe('plant-1')
    expect(clonePlant).toMatchObject({
      canonicalName: 'Malus domestica',
      position: { x: 100, y: 120 },
      rotationDeg: 15,
    })
    expect(cloneZone).toMatchObject({
      name: 'Kitchen bed',
      points: [
        { x: 70, y: 100 },
        { x: 90, y: 100 },
        { x: 90, y: 130 },
        { x: 70, y: 130 },
      ],
      fillColor: '#A06B1F',
      notes: 'Bed',
    })
    expect(cloneAnnotation.id).not.toBe('annotation-1')
    expect(cloneAnnotation).toMatchObject({
      position: { x: 120, y: 110 },
      text: 'Guild',
      fontSize: 20,
      rotationDeg: 10,
    })
    expect(cloneGroup).toMatchObject({
      name: 'Guild unit',
      members: [
        { kind: 'plant', id: clonePlant.id },
        { kind: 'zone', id: cloneZone.id },
        { kind: 'annotation', id: cloneAnnotation.id },
      ],
    })
    expect(cloneGroup.id).not.toBe('group-1')
    expect(store.persisted.groups[0]?.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'Kitchen bed' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(selectedObjectIds.value).toEqual(new Set([cloneGroup.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    session.dispose()
  })

  it('places Saved Object Stamps with full ghost preview and selected unlocked copies', () => {
    selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 12, y: 24 },
      plants: [{
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'canopy',
        position: { x: 12, y: 24 },
        rotationDeg: 15,
        scale: 4,
      }],
      zones: [{
        id: 'zone-1',
        name: 'Kitchen bed',
        zoneType: 'rect',
        points: [
          { x: 2, y: 10 },
          { x: 22, y: 10 },
          { x: 22, y: 30 },
          { x: 2, y: 30 },
        ],
        rotationDeg: 0,
        fillColor: '#A06B1F',
      }],
      annotations: [{
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 30, y: 20 },
        text: 'Guild',
        fontSize: 16,
        rotationDeg: 5,
      }],
      groups: [{
        id: 'group-1',
        name: 'Guild unit',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      }],
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('saved-object-stamp')

    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    expect(container.querySelectorAll('[data-saved-object-stamp-ghost]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-saved-object-stamp-part]')).toHaveLength(3)

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.groups).toHaveLength(1)

    const plant = store.persisted.plants[0]!
    const zone = store.persisted.zones[0]!
    const annotation = store.persisted.annotations[0]!
    const group = store.persisted.groups[0]!

    expect(plant).toMatchObject({
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'canopy',
      position: { x: 100, y: 120 },
      rotationDeg: 15,
      notes: null,
      plantedDate: null,
      quantity: null,
    })
    expect(zone).toMatchObject({
      locked: false,
      name: 'Kitchen bed',
      points: [
        { x: 90, y: 106 },
        { x: 110, y: 106 },
        { x: 110, y: 126 },
        { x: 90, y: 126 },
      ],
      fillColor: '#A06B1F',
      notes: null,
    })
    expect(annotation).toMatchObject({
      locked: false,
      position: { x: 118, y: 116 },
      text: 'Guild',
      fontSize: 16,
      rotationDeg: 5,
    })
    expect(group).toMatchObject({
      name: 'Guild unit',
      locked: false,
      members: [
        { kind: 'plant', id: plant.id },
        { kind: 'zone', id: zone.id },
        { kind: 'annotation', id: annotation.id },
      ],
    })
    expect(selectedObjectIds.value).toEqual(new Set([group.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-saved-object-stamp')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()
    session.dispose()
  })

  describe('stamp rotation', () => {
    function holdSavedStamp(): void {
      selectSavedObjectStampSourceForTests({
        version: 2,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, symbol: null,
          position: { x: 10, y: 0 }, rotationDeg: null, scale: null,
        }],
        zones: [{
          id: 'zone-1', name: null, zoneType: 'rect', rotationDeg: 0, fillColor: null,
          points: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }],
        }],
        annotations: [{
          id: 'annotation-1', annotationType: 'text', position: { x: 0, y: 10 }, text: 'Mulch', fontSize: 16, rotationDeg: null,
        }],
        groups: [],
      })
    }

    function rotationSession(overrides: Parameters<typeof createInteractionDeps>[3] = {}) {
      const published: CanvasToolGuidance[] = []
      const deps = createInteractionDeps(container, store, camera, {
        publishToolGuidance: (guidance) => { published.push(guidance) },
        ...overrides,
      })
      return { session: createTestSession(deps), angle: () => published.at(-1)?.stampRotationDeg }
    }

    it('turns a held saved stamp by 15° with ] and [, in its preview and in the objects it places', () => {
      holdSavedStamp()
      const { session, angle } = rotationSession()
      session.setTool('saved-object-stamp')
      events.pointerMove({ x: 100, y: 100 }, { button: 0 })
      expect(angle()).toBe(0)

      for (let turn = 0; turn < 7; turn += 1) events.keyDown({ key: ']', target: container })
      events.keyDown({ key: '[', target: container })
      expect(angle()).toBe(90)
      // The ghost turns with it: the plant 10 m east of the anchor now shows 10 m south of the pointer.
      // At this zoom the plant is a dot.
      const plantGhost = container.querySelector('[data-saved-object-stamp-part="plant-symbol"] circle')
      expect([plantGhost?.getAttribute('cx'), plantGhost?.getAttribute('cy')]).toEqual(['100', '110'])

      events.pointerDown({ x: 100, y: 100 }, { button: 0 })
      expect(store.persisted.plants[0]?.position).toEqual({ x: 100, y: 110 })
      expect(store.persisted.zones[0]?.rotationDeg).toBe(90)
      expect(store.persisted.annotations[0]).toMatchObject({ position: { x: 90, y: 100 }, rotationDeg: 90 })
      session.dispose()
    })

    it('keeps ] and [ to the stamp while one is held, and leaves them to the shortcuts otherwise', () => {
      const bubbled = vi.fn()
      document.addEventListener('keydown', bubbled)
      try {
        const { session, angle } = rotationSession()
        session.setTool('object-stamp')
        // Nothing held yet: ] is still Bring to front.
        expect(events.keyDown({ key: ']', target: container }).defaultPrevented).toBe(false)
        expect(bubbled).toHaveBeenCalledOnce()

        store.updatePersisted((draft) => {
          draft.plants = [{
            kind: 'plant', locked: false, id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple',
            color: null, stratum: null, canopySpreadM: 2, position: { x: 50, y: 60 }, rotationDeg: null,
            notes: null, plantedDate: null, quantity: 1,
          }]
        })
        events.pointerDown({ x: 54, y: 63 }, { button: 0 })
        const held = events.keyDown({ key: ']', target: container })
        expect(held.defaultPrevented).toBe(true)
        expect(bubbled).toHaveBeenCalledOnce()
        expect(angle()).toBe(15)
        // Modified brackets and brackets typed in a field are not stamp turns.
        events.keyDown({ key: ']', ctrlKey: true, target: container })
        const field = document.createElement('input')
        container.appendChild(field)
        events.keyDown({ key: ']', target: field })
        expect(angle()).toBe(15)

        for (let turn = 0; turn < 5; turn += 1) events.keyDown({ key: ']', target: container })
        // The sampled plant was picked 4 m east and 3 m south of its centre; at 90° that offset turns too.
        events.pointerDown({ x: 100, y: 120 }, { button: 0 })
        expect(store.persisted.plants[1]?.position).toEqual({ x: 103, y: 116 })
        session.dispose()
      } finally {
        document.removeEventListener('keydown', bubbled)
      }
    })

    it('with single-key shortcuts off, turns the stamp only while the map has focus', () => {
      holdSavedStamp()
      const { session, angle } = rotationSession({ readSingleKeyShortcuts: () => false })
      session.setTool('saved-object-stamp')
      events.pointerMove({ x: 100, y: 100 }, { button: 0 })

      expect(events.keyDown({ key: ']' }).defaultPrevented).toBe(false)
      expect(angle()).toBe(0)
      events.keyDown({ key: ']', target: container })
      expect(angle()).toBe(15)
      session.dispose()
    })

    it('starts each new stamp upright', () => {
      holdSavedStamp()
      const { session, angle } = rotationSession()
      session.setTool('saved-object-stamp')
      events.keyDown({ key: ']', target: container })
      expect(angle()).toBe(15)
      holdSavedStamp()
      events.pointerMove({ x: 100, y: 100 }, { button: 0 })
      expect(angle()).toBe(0)
      session.setTool('select')
      expect(angle()).toBeNull()
      session.dispose()
    })
  })

  it('blocks Saved Object Stamp placement when any target Layer is locked', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [],
      zones: [{
        id: 'zone-1',
        name: 'Kitchen bed',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        rotationDeg: 0,
        fillColor: null,
      }],
      annotations: [],
      groups: [],
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('saved-object-stamp')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('blocks Object Stamp sampling and placement for locked group sources or locked group layers', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
        locked: false,
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        name: 'Guild unit',
        locked: false,
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.groups = draft.groups.map((group) =>
        group.id === 'group-1' ? { ...group, locked: true } : group,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.groups = draft.groups.map((group) =>
        group.id === 'group-1' ? { ...group, locked: false } : group,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.locked = true
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('blocks Object Stamp sampling and placement for group sources containing locked members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Guild unit',
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: false } : plant,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
      )
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })
})
