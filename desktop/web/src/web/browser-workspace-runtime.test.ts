import { signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestCanvasQuerySurface } from '../__tests__/support/canvas-query-surface'
import type { WorkspaceRuntimeCompositionOptions } from '../app/canvas-map-surface/workspace-runtime-composition'
import type { DesignSessionStore } from '../app/document-session/store'
import type { WorkspaceRuntimeComposition } from '../app/canvas-map-surface/workspace-runtime-composition'
import { newDesignSpatialFrame } from '../spatial-frame'
import { createBrowserWorkspaceRuntimeComposition } from './browser-workspace-runtime'

const workspaceMocks = vi.hoisted(() => ({
  createComposition: vi.fn(),
}))

vi.mock('../app/canvas-map-surface/workspace-runtime-composition', async (importOriginal) => ({
  ...await importOriginal<typeof import('../app/canvas-map-surface/workspace-runtime-composition')>(),
  createWorkspaceRuntimeComposition: workspaceMocks.createComposition,
}))

beforeEach(() => {
  workspaceMocks.createComposition.mockReset()
})

describe('browser workspace runtime composition', () => {
  it('binds one injected Design store to activation and contribution snapshots', () => {
    const sessionIdentity = {}
    const readMetadata = vi.fn(() => ({
      spatialFrame: {
        ...newDesignSpatialFrame(),
        anchor_latitude_deg: 48,
        anchor_longitude_deg: 2,
        north_bearing_deg: 12,
        placement_status: 'confirmed' as const,
      },
    }))
    const hasCurrentDesign = vi.fn(() => true)
    const store: Pick<
      DesignSessionStore,
      'sessionIdentity' | 'hasCurrentDesign' | 'readMetadata'
    > = {
      sessionIdentity: signal(sessionIdentity),
      hasCurrentDesign,
      readMetadata,
    }
    const composition = {} as WorkspaceRuntimeComposition
    workspaceMocks.createComposition.mockReturnValue(composition)

    const result = createBrowserWorkspaceRuntimeComposition({
      container: document.createElement('div'),
      store,
    })

    expect(result).toBe(composition)
    const options = workspaceMocks.createComposition.mock.calls[0]![0] as
      WorkspaceRuntimeCompositionOptions
    const activation = options.readSnapshot!()
    const contributions = options.mapContributions.read(createTestCanvasQuerySurface())

    expect(activation?.sessionIdentity).toBe(sessionIdentity)
    expect(activation?.map).toMatchObject({
      anchor: { lat: 48, lon: 2 },
      northBearingDeg: 12,
      placementStatus: 'confirmed',
    })
    expect(contributions?.sessionIdentity).toBe(sessionIdentity)
    expect(contributions?.overlays.location).toEqual({ lat: 48, lon: 2 })
    expect(hasCurrentDesign).toHaveBeenCalledTimes(2)
    expect(readMetadata).toHaveBeenCalledTimes(2)
  })
})
