import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import { geoAt } from '../../../__tests__/support/geo-design'
import { CURRENT_CANOPI_FILE_VERSION } from '../../../generated/canopi-design-format'
import type { CanopiFile } from '../../../types/design'
import type { SessionPlane } from '../../session-plane'
import { createDetachedCanvasRuntimeAppAdapter } from '../app-adapter'
import { SceneCanvasRuntime } from '../scene-runtime'
import type { SceneEditCoordinator } from './transactions'

function makeFile(): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Re-origin demo',
    description: null,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      {
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: geoAt(10, 10),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-2',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: geoAt(30, 20),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ],
    zones: [
      {
        name: 'bed',
        zone_type: 'rect',
        rotation: 0,
        points: [geoAt(0, 0), geoAt(8, 0), geoAt(8, 6), geoAt(0, 6)],
        fill_color: null,
        notes: null,
        locked: false,
      },
      {
        name: 'pond',
        zone_type: 'ellipse',
        rotation: 15,
        points: [geoAt(20, 30), geoAt(26, 34)],
        fill_color: null,
        notes: null,
        locked: false,
      },
    ],
    annotations: [{
      id: 'note-1',
      annotation_type: 'text',
      position: geoAt(5, 40),
      text: 'Gate',
      font_size: 14,
      rotation: null,
      locked: false,
    }],
    measurement_guides: [{
      id: 'measurement-guide-1',
      locked: false,
      start: geoAt(0, 50),
      end: geoAt(40, 50),
    }],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: { guides: [{ id: 'ruler-1', axis: 'h', lat: geoAt(0, 12).lat }] },
  }
}

const SCREEN = { width: 400, height: 300 }
const FAR_EAST_METERS = 20_000

function createRuntime() {
  const setCanvasClean = vi.fn<(clean: boolean) => void>()
  const runtime = new SceneCanvasRuntime({
    appAdapter: {
      ...createDetachedCanvasRuntimeAppAdapter(),
      cleanState: { setCanvasClean },
    },
  })
  const file = makeFile()
  runtime.documentSurface.loadDocument(file)
  runtime.documentSurface.resize(SCREEN.width, SCREEN.height)
  return { runtime, file, setCanvasClean }
}

function sessionPlane(runtime: SceneCanvasRuntime): SessionPlane {
  return runtime.querySurface.sessionPlane.value!
}

/** Centres the view on a session-plane point at the given scale. */
function centreViewOn(runtime: SceneCanvasRuntime, point: { x: number; y: number }, scale = 1): void {
  ;(runtime as any)._camera.setViewport({
    x: SCREEN.width / 2 - point.x * scale,
    y: SCREEN.height / 2 - point.y * scale,
    scale,
  })
}

function sceneEdits(runtime: SceneCanvasRuntime): SceneEditCoordinator {
  return (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
}

function savedScene(runtime: SceneCanvasRuntime, file: CanopiFile) {
  const content = runtime.documentSurface.captureForPersistence({ name: file.name }, file).content
  return {
    plants: content.plants,
    zones: content.zones,
    annotations: content.annotations,
    measurement_guides: content.measurement_guides,
    extra: content.extra,
  }
}

async function settleReorigin(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

// Changed positions are saved at 1e-9 degree precision.
function geoNear(point: { lon: number; lat: number }) {
  return { lon: expect.closeTo(point.lon, 8), lat: expect.closeTo(point.lat, 8) }
}

describe('session plane re-origin', () => {
  it('moves the plane origin to a distant view centre without moving any saved lon/lat or dirtying the Design', async () => {
    const { runtime, file, setCanvasClean } = createRuntime()
    try {
      const before = savedScene(runtime, file)
      const previous = sessionPlane(runtime)
      const farCentre = { x: FAR_EAST_METERS, y: 0 }
      const expectedOrigin = previous.toGeo(farCentre)
      setCanvasClean.mockClear()

      centreViewOn(runtime, farCentre)
      await settleReorigin()

      const next = sessionPlane(runtime)
      expect(next).not.toBe(previous)
      expect(next.origin.lon).toBeCloseTo(expectedOrigin.lon, 9)
      expect(next.origin.lat).toBeCloseTo(expectedOrigin.lat, 9)
      // The camera is reprojected with the plane, so the view stays put.
      const viewport = runtime.querySurface.viewport.value.viewport
      const centre = {
        x: (SCREEN.width / 2 - viewport.x) / viewport.scale,
        y: (SCREEN.height / 2 - viewport.y) / viewport.scale,
      }
      expect(Math.hypot(centre.x, centre.y)).toBeLessThan(0.01)

      expect(savedScene(runtime, file)).toEqual(before)
      expect(setCanvasClean).not.toHaveBeenCalledWith(false)
      expect(runtime.commandSurface.history.canUndo.value).toBe(false)
      expect(runtime.commandSurface.history.canRedo.value).toBe(false)
    } finally {
      runtime.destroy()
    }
  })

  it('does not re-origin while the view stays within 10 km of the origin', async () => {
    const { runtime } = createRuntime()
    try {
      const previous = sessionPlane(runtime)
      centreViewOn(runtime, { x: 9_000, y: 0 })
      await settleReorigin()
      expect(sessionPlane(runtime)).toBe(previous)
    } finally {
      runtime.destroy()
    }
  })

  it('remaps undo history so replayed edits restore the right geographic positions', async () => {
    const { runtime, file } = createRuntime()
    try {
      const original = savedScene(runtime, file).plants[0]!.position
      expect(sceneEdits(runtime).run('move-plant', (tx) => {
        tx.mutate((draft) => {
          draft.plants[0]!.position = { x: draft.plants[0]!.position.x + 3, y: draft.plants[0]!.position.y }
        })
      })).toBe(true)
      const moved = savedScene(runtime, file).plants[0]!.position
      const previous = sessionPlane(runtime)

      centreViewOn(runtime, { x: FAR_EAST_METERS, y: 0 })
      await settleReorigin()
      expect(sessionPlane(runtime)).not.toBe(previous)
      expect(savedScene(runtime, file).plants[0]!.position).toEqual(moved)

      runtime.commandSurface.history.undo()
      expect(savedScene(runtime, file).plants[0]!.position).toEqual(original)

      runtime.commandSurface.history.redo()
      expect(savedScene(runtime, file).plants[0]!.position).toEqual(moved)
    } finally {
      runtime.destroy()
    }
  })

  it('pastes a selection copied before re-origin at the same lon/lat plus the paste offset', async () => {
    const { runtime, file } = createRuntime()
    try {
      runtime.commandSurface.sceneEdits.selectAll()
      runtime.commandSurface.sceneEdits.copy()
      const previous = sessionPlane(runtime)
      const copiedPlant = runtime.querySurface.getSceneSnapshot().plants[0]!
      // Paste places copies one metre east of their source.
      const expectedPaste = previous.toGeo({ x: copiedPlant.position.x + 1, y: copiedPlant.position.y })

      centreViewOn(runtime, { x: FAR_EAST_METERS, y: 0 })
      await settleReorigin()
      expect(sessionPlane(runtime)).not.toBe(previous)

      runtime.commandSurface.sceneEdits.paste()
      const plants = savedScene(runtime, file).plants
      expect(plants).toHaveLength(4)
      expect(plants[2]!.canonical_name).toBe(copiedPlant.canonicalName)
      expect(plants[2]!.position).toEqual(geoNear(expectedPaste))
    } finally {
      runtime.destroy()
    }
  })

  it('waits for an active Scene Edit to settle before re-origining', async () => {
    const { runtime } = createRuntime()
    try {
      const previous = sessionPlane(runtime)
      const active = sceneEdits(runtime).begin('interaction-drag')

      centreViewOn(runtime, { x: FAR_EAST_METERS, y: 0 })
      await settleReorigin()
      expect(sessionPlane(runtime)).toBe(previous)

      active.abort()
      // The next camera frame after the edit settles re-origins.
      centreViewOn(runtime, { x: FAR_EAST_METERS + 1, y: 0 })
      await settleReorigin()
      expect(sessionPlane(runtime)).not.toBe(previous)
    } finally {
      runtime.destroy()
    }
  })

  it('does not re-origin in overview mode', async () => {
    const { runtime } = createRuntime()
    try {
      const previous = sessionPlane(runtime)
      centreViewOn(runtime, { x: 500_000, y: 0 }, 0.001)
      expect(runtime.querySurface.viewport.value.mode).toBe('overview')
      await settleReorigin()
      expect(sessionPlane(runtime)).toBe(previous)
    } finally {
      runtime.destroy()
    }
  })
})
