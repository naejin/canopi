import { describe, expect, it, vi } from 'vitest'
import {
  activeTool,
  highlightedConsortium,
  layerLockState,
  layerOpacity,
  layerVisibility,
  lockedObjectIds,
  selectedObjectIds,
} from '../state/canvas'
import { loadDocumentSession, resetTransientCanvasSession } from '../canvas/runtime/document-session'
import type { CanopiFile } from '../types/design'

describe('document session reset', () => {
  it('clears transient canvas session state before document replacement', () => {
    activeTool.value = 'rectangle'
    selectedObjectIds.value = new Set(['shape-1'])
    lockedObjectIds.value = new Set(['shape-2'])
    highlightedConsortium.value = 'consortium-1'

    resetTransientCanvasSession()

    expect(activeTool.value).toBe('select')
    expect(selectedObjectIds.value.size).toBe(0)
    expect(lockedObjectIds.value.size).toBe(0)
    expect(highlightedConsortium.value).toBe(null)
  })

  it('resets layer state to defaults before applying loaded layer settings', () => {
    layerVisibility.value = {
      base: false,
      contours: true,
      climate: true,
      zones: false,
      water: true,
      plants: false,
      annotations: false,
    }
    layerLockState.value = {
      base: true,
      contours: true,
      climate: true,
      zones: true,
      water: true,
      plants: true,
      annotations: true,
    }
    layerOpacity.value = {
      base: 0.2,
      contours: 0.3,
      climate: 0.4,
      zones: 0.5,
      water: 0.6,
      plants: 0.7,
      annotations: 0.8,
    }

    const layerNames = ['base', 'contours', 'climate', 'zones', 'water', 'plants', 'annotations']
    const layers = new Map(
      layerNames.map((name) => {
        const layer = {
          visible: vi.fn(),
          opacity: vi.fn(),
          destroyChildren: vi.fn(),
          batchDraw: vi.fn(),
          add: vi.fn(),
          find: vi.fn(() => []),
        }
        return [name, layer]
      }),
    ) as any

    const file: CanopiFile = {
      version: 1,
      name: 'Loaded',
      description: null,
      location: null,
      north_bearing_deg: 0,
      layers: [
        { name: 'plants', visible: false, locked: true, opacity: 0.35 },
      ],
      plants: [],
      zones: [],
      consortiums: [],
      timeline: [],
      budget: [],
      created_at: '',
      updated_at: '',
      extra: {},
    }

    loadDocumentSession(file, {
      stage: { scaleX: () => 1 } as any,
      layers,
      restoreGuides: vi.fn(),
      restoreObjectGroups: vi.fn(),
      reconcileMaterializedScene: vi.fn(),
    })

    expect(layerVisibility.value).toEqual({
      base: true,
      contours: false,
      climate: false,
      zones: true,
      water: false,
      plants: false,
      annotations: true,
    })
    expect(layerLockState.value).toEqual({
      base: false,
      contours: false,
      climate: false,
      zones: false,
      water: false,
      plants: true,
      annotations: false,
    })
    expect(layerOpacity.value).toEqual({
      base: 1,
      contours: 1,
      climate: 1,
      zones: 1,
      water: 1,
      plants: 0.35,
      annotations: 1,
    })
  })
})
