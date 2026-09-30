import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDetachedCanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { MAPLIBRE_SCENE_RENDERER_ID } from '../../canvas/runtime/renderers/maplibre-scene'
import { createDetachedSceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'
import {
  createSessionPlane,
  DEFAULT_NEW_DESIGN_VIEW,
  type SessionPlane,
} from '../../canvas/session-plane'
import { MapLibreWorkspaceCameraOwner } from '../../maplibre/workspace-camera'
import type { SharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import type { WorkspaceActivationOptions } from './workspace-activation'
import type { WorkspaceGenerationLifecycle } from './workspace-generation-reconciler'
import { createWorkspaceRuntimeComposition } from './workspace-runtime-composition'
import { createTestCanvasRuntimeSurfaces } from '../../__tests__/support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'

// Moved from __tests__/workspace-camera-refresh-origin.test.ts: the composition's origin effect, which re-expresses the attached
// camera in each new session plane and gives the workspace the live plane origin.
describe('workspace runtime composition origin effect', () => {
  function compositionFixture() {
    const sessionPlane = signal<SessionPlane | null>(null)
    const surfaces = createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), sessionPlane },
    })
    const runtime = {
      commandSurface: surfaces.commands,
      querySurface: surfaces.queries,
      documentSurface: surfaces.documents,
      init: vi.fn(async () => {}),
      unmountRenderer: vi.fn(async () => {}),
      destroy: vi.fn(),
    }
    const camera = new MapLibreWorkspaceCameraOwner()
    const refreshOrigin = vi.spyOn(camera.attachment, 'refreshOrigin')
    const workspace = {
      requestGenerationDisconnect: vi.fn(async () => {}),
      activate: vi.fn(async () => 'shared-ready' as const),
      teardown: vi.fn(async () => {}),
      updateMapContributions: vi.fn(),
      updateBackgroundPresentation: vi.fn(),
    } satisfies WorkspaceGenerationLifecycle & {
      updateMapContributions(snapshot: unknown): void
      updateBackgroundPresentation(presentation: unknown): void
    }
    const createWorkspace = vi.fn((_input: WorkspaceActivationOptions) => workspace)
    const readSnapshot = vi.fn(
      (_readInitialCenter: () => { readonly lat: number; readonly lon: number }) => null,
    )
    const composition = createWorkspaceRuntimeComposition({
      container: document.createElement('div'),
      appAdapter: createDetachedCanvasRuntimeAppAdapter(),
      targetPresentation: createDetachedSceneRuntimePanelTargetAdapter(),
      mapContributions: { read: () => null },
      readSnapshot,
      readBackgroundPresentation: () => ({
        basemap: { style: 'liberty', visible: true, opacity: 1 },
        satellite: { visible: false, opacity: 1 },
        locale: 'en',
      }),
    }, {
      createRendererComposition: () => ({
        renderer: { id: MAPLIBRE_SCENE_RENDERER_ID, initialize: vi.fn() },
        createLayer: vi.fn(),
      }) as unknown as SharedMapSceneRendererComposition,
      createCamera: () => camera,
      createRuntime: () => runtime,
      createControls: () => ({
        createMap: vi.fn(),
        releaseMap: vi.fn(),
        getWebGL2Context: vi.fn(() => null),
        updateMapContributions: vi.fn(),
        updateBackgroundPresentation: vi.fn(),
        installStyleRestorer: vi.fn(() => () => {}),
      }),
      createWorkspace,
    })
    return { composition, sessionPlane, refreshOrigin, createWorkspace, readSnapshot }
  }

  it('refreshes the camera origin whenever the runtime session plane changes, until disposal', async () => {
    const fixture = compositionFixture()
    await expect(fixture.composition.start()).resolves.toBe('no-design')
    expect(fixture.refreshOrigin).not.toHaveBeenCalled()

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    expect(fixture.refreshOrigin).toHaveBeenCalledOnce()

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.6, lat: 48.9 })
    expect(fixture.refreshOrigin).toHaveBeenCalledTimes(2)

    await fixture.composition.dispose()
    fixture.sessionPlane.value = createSessionPlane({ lon: 3, lat: 49 })
    expect(fixture.refreshOrigin).toHaveBeenCalledTimes(2)
  })

  it('reads the live session plane origin for the workspace and the initial map centre', async () => {
    const fixture = compositionFixture()
    await fixture.composition.start()
    const readOrigin = fixture.createWorkspace.mock.calls[0]![0].readOrigin
    const readInitialCenter = fixture.readSnapshot.mock.calls[0]![0]

    expect(readOrigin()).toEqual({ lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon })
    expect(readInitialCenter()).toEqual({ lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon })

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    expect(readOrigin()).toEqual({ lat: 48.8566, lon: 2.3522 })
    expect(readInitialCenter()).toEqual({ lat: 48.8566, lon: 2.3522 })
    await fixture.composition.dispose()
  })
})
