import { batch, effect } from '@preact/signals'
import type {
  CanvasRuntimeAppAdapter,
  CanvasRuntimeLayerProjectionSource,
} from '../canvas/runtime/app-adapter'
import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../canvas/runtime/runtime'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../canvas/runtime/surfaces'
import { createDetachedCanvasPlantLabelSource, createDetachedCanvasSpeciesPresentationCache } from '../canvas/runtime/presentation-data'
import {
  gridVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
  rulersVisible,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../app/canvas-settings/signals'
import { locale, plantSpacingIntervalM, theme } from '../app/settings/state'
import { mutateSettingsProjection } from '../app/settings/projection'
import { composeDocumentForSave } from '../app/contracts/document'
import { setCanvasClean } from '../app/document-session/store'
import { createAppSceneRuntimePanelTargetAdapter } from '../app/canvas-runtime/panel-target-adapter'

const APP_OWNED_LAYER_PROJECTIONS = new Set(['base', 'contours'])

export function createBrowserCanvasRuntimeHost(): CanvasRuntimeHost {
  const runtime = new SceneCanvasRuntime({
    appAdapter: createBrowserCanvasRuntimeAppAdapter(),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
    plantLabels: createDetachedCanvasPlantLabelSource(),
    speciesCache: createDetachedCanvasSpeciesPresentationCache(),
  })
  return new BrowserSceneCanvasRuntimeHost(runtime, createCanvasRuntimeSurfaces(runtime))
}

export function createBrowserCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return {
    cleanState: { setCanvasClean },
    document: { composeDocumentForSave },
    savedObjectStamps: {
      saveCurrentSelection: () => {},
    },
    settings: {
      readLocale: () => locale.value,
      readChromeOverlay: () => ({
        gridVisible: gridVisible.value,
        rulersVisible: rulersVisible.value,
      }),
      readSnapToGridEnabled: () => snapToGridEnabled.value,
      readSnapToGuidesEnabled: () => snapToGuidesEnabled.value,
      readPlantSpacingIntervalMeters: () => plantSpacingIntervalM.value,
      commitPlantSpacingIntervalMeters: (meters) => {
        mutateSettingsProjection((settings) => {
          settings.plantSpacingIntervalM = meters
        }, { persist: 'immediate' })
      },
      toggleGridVisible: () => {
        gridVisible.value = !gridVisible.value
      },
      toggleSnapToGrid: () => {
        mutateSettingsProjection((settings) => {
          settings.snapToGrid = !settings.snapToGrid
        }, { persist: 'immediate' })
      },
      toggleRulersVisible: () => {
        rulersVisible.value = !rulersVisible.value
      },
      subscribeTheme: (onChange) => effect(() => {
        void theme.value
        onChange()
      }),
      subscribeLocale: (onChange) => effect(() => {
        void locale.value
        onChange()
      }),
      subscribeChromeOverlay: (onChange) => effect(() => {
        void gridVisible.value
        void rulersVisible.value
        onChange()
      }),
      layerProjections: {
        isAppOwnedLayerProjection: (name) => APP_OWNED_LAYER_PROJECTIONS.has(name),
        syncFromLayers,
        syncLayer,
      },
    },
  }
}

class BrowserSceneCanvasRuntimeHost implements CanvasRuntimeHost {
  constructor(
    private readonly runtime: SceneCanvasRuntime,
    readonly surfaces: CanvasRuntimeSurfaces,
  ) {}

  init(container: HTMLElement): Promise<void> {
    return this.runtime.init(container)
  }

  destroy(): void {
    this.runtime.destroy()
  }
}

function syncFromLayers(layers: ReadonlyArray<CanvasRuntimeLayerProjectionSource>): void {
  const visibility = { ...layerVisibility.value }
  const locks = { ...layerLockState.value }
  const opacities = { ...layerOpacity.value }

  for (const layer of layers) {
    if (APP_OWNED_LAYER_PROJECTIONS.has(layer.name)) continue
    visibility[layer.name] = layer.visible
    locks[layer.name] = layer.locked
    opacities[layer.name] = layer.opacity
  }

  batch(() => {
    layerVisibility.value = visibility
    layerLockState.value = locks
    layerOpacity.value = opacities
  })
}

function syncLayer(layer: CanvasRuntimeLayerProjectionSource): void {
  if (APP_OWNED_LAYER_PROJECTIONS.has(layer.name)) return

  batch(() => {
    layerVisibility.value = {
      ...layerVisibility.value,
      [layer.name]: layer.visible,
    }
    layerLockState.value = {
      ...layerLockState.value,
      [layer.name]: layer.locked,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      [layer.name]: layer.opacity,
    }
  })
}
