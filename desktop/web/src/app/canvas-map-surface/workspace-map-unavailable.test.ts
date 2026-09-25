import { describe, expect, it, vi } from 'vitest'
import { createDetachedCanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { createDetachedSceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'
import { createSharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import { WorkspaceMapControls } from './workspace-map-controls'
import { createWorkspaceRuntimeComposition } from './workspace-runtime-composition'
import type { WorkspaceActivationSnapshot } from './workspace-activation'

function workspaceSnapshot(): WorkspaceActivationSnapshot {
  return {
    sessionIdentity: {},
    map: {
      initialCenter: { lat: 48.86, lon: 2.35 },
      background: {
        basemap: { style: 'liberty', visible: true, opacity: 1 },
        satellite: { provider: 'eox', visible: false, opacity: 1 },
        locale: 'en',
      },
    },
  }
}

describe('shared workspace without WebGL2', () => {
  it('shows the map-unavailable state and mounts no renderer', async () => {
    const container = document.createElement('div')
    const states: MapLibreCanvasSurfaceState[] = []
    const rendererComposition = createSharedMapSceneRendererComposition()
    const initializeRenderer = vi.spyOn(rendererComposition.renderer, 'initialize')
    const onFailure = vi.fn()
    const composition = createWorkspaceRuntimeComposition({
      container,
      appAdapter: createDetachedCanvasRuntimeAppAdapter(),
      targetPresentation: createDetachedSceneRuntimePanelTargetAdapter(),
      mapContributions: { read: () => null },
      onMapStateChange: (state) => states.push(state),
      onFailure,
      readSnapshot: () => workspaceSnapshot(),
    }, {
      createRendererComposition: () => rendererComposition,
      createControls: (options) => new WorkspaceMapControls({
        ...options,
        canCreateWebGL2Context: () => false,
      }),
    })

    await expect(composition.start()).resolves.toBe('map-unavailable')

    expect(states.at(-1)).toMatchObject({
      status: 'error',
      errorMessage: expect.stringContaining('WebGL2 is unavailable'),
    })
    expect(initializeRenderer).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.childElementCount).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
    await composition.dispose()
  })
})
