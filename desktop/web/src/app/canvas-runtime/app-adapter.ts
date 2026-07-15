import { batch, effect } from '@preact/signals'
import type {
  CanvasRuntimeAppAdapter,
  CanvasRuntimeLayerProjectionSource,
} from '../../canvas/runtime/app-adapter'
import { CanvasPlantLabelResolver } from '../../canvas/runtime/plant-labels'
import { CanvasSpeciesCache } from '../../canvas/runtime/species-cache'
import {
  gridVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
  rulersVisible,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../canvas-settings/signals'
import { mutateSettingsProjection } from '../settings/projection'
import { locale, plantSpacingIntervalM, theme } from '../settings/state'
import { composeDocumentForSave } from '../contracts/document'
import { setCanvasClean } from '../document-session/store'
import { savedObjectStampWorkbench } from '../saved-object-stamps'

const APP_OWNED_LAYER_PROJECTIONS = new Set(['base', 'contours'])

export function createAppCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  const plantLabels = new CanvasPlantLabelResolver()
  const speciesCache = new CanvasSpeciesCache()

  return {
    cleanState: { setCanvasClean },
    document: { composeDocumentForSave },
    savedObjectStamps: {
      saveCurrentSelection: (capture) => savedObjectStampWorkbench.saveSelection(capture),
    },
    presentationData: {
      plantLabels,
      speciesCache,
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
