import { batch, effect } from '@preact/signals'
import type {
  CanvasRuntimeAppAdapter,
  CanvasRuntimeLayerProjectionSource,
  CanvasRuntimePresentationDataAdapter,
  CanvasRuntimeSavedObjectStampAdapter,
} from '../../canvas/runtime/app-adapter'
import type { CanvasMapBackdrop } from '../../canvas/runtime/scene-visuals'
import { effectiveBackgroundOpacity, mapBackgroundOf, mapLayers, type MapLayersState } from '../map-layers/state'
import {
  gridVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
  rulersVisible,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../canvas-settings/signals'
import { newDesignViewFrom } from '../canvas-map-surface/last-view'
import { mutateSettingsProjection } from '../settings/projection'
import { lastView, locale, plantSpacingIntervalM, theme } from '../settings/state'
import { composeDocumentForSave } from '../contracts/document'
import { setCanvasClean } from '../document-session/store'
import { closeCanvasContextMenu, openCanvasContextMenu } from '../canvas-context-menu/state'
import { t } from '../../i18n'
import { currentPlantDisplay } from '../plant-display/state'

export interface CanvasRuntimeAppCapabilities {
  readonly presentationData: CanvasRuntimePresentationDataAdapter
  readonly savedObjectStamps?: CanvasRuntimeSavedObjectStampAdapter
  /**
   * Numeric inspection hook, supplied by the edition that has the capability.
   *
   * It is a capability rather than an import because importing it here would
   * pull the raster IPC and library store into the browser workspace graph,
   * which the architecture guard forbids: Web has no raster capability.
   */
  readonly tryInspectAt?: (point: { readonly x: number; readonly y: number }) => boolean
}

export function createAppCanvasRuntimeAppAdapter(
  capabilities: CanvasRuntimeAppCapabilities,
): CanvasRuntimeAppAdapter {
  return {
    cleanState: { setCanvasClean },
    document: { composeDocumentForSave },
    contextMenu: { open: openCanvasContextMenu, close: closeCanvasContextMenu },
    // Read per gesture, so an inspection session needs no runtime rebuild, and
    // absent in an edition that has no raster capability.
    ...(capabilities.tryInspectAt ? { tryInspectAt: capabilities.tryInspectAt } : {}),
    ...(capabilities.savedObjectStamps
      ? { savedObjectStamps: capabilities.savedObjectStamps }
      : {}),
    presentationData: capabilities.presentationData,
    plantDisplay: {
      subscribe: (onChange) => effect(() => {
        onChange(currentPlantDisplay.value)
      }),
    },
    translate: t,
    settings: {
      readLocale: () => locale.value,
      readChromeOverlay: () => ({
        gridVisible: gridVisible.value,
        rulersVisible: rulersVisible.value,
      }),
      readSnapToGridEnabled: () => snapToGridEnabled.value,
      readSnapToGuidesEnabled: () => snapToGuidesEnabled.value,
      readPlantSpacingIntervalMeters: () => plantSpacingIntervalM.value,
      readLastView: () => newDesignViewFrom(lastView.peek()),
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
      subscribeMapBackdrop: (onChange) => effect(() => {
        onChange(mapBackdropOf(mapLayers.value))
      }),
      layerProjections: {
        syncFromLayers,
        syncLayer,
      },
    },
  }
}

/** Below half opacity a background mostly lets the map's light paper through. */
const BACKDROP_OPACITY_THRESHOLD = 0.5

function mapBackdropOf(state: MapLayersState): CanvasMapBackdrop {
  switch (mapBackgroundOf(state)) {
    case 'satellite':
      return effectiveBackgroundOpacity(state, 'satellite') < BACKDROP_OPACITY_THRESHOLD ? 'paper' : 'satellite'
    case 'basemap':
      if (effectiveBackgroundOpacity(state, 'basemap') < BACKDROP_OPACITY_THRESHOLD) return 'paper'
      return state.basemap.style === 'dark' ? 'dark-basemap' : 'basemap'
    case 'none':
      return 'paper'
  }
}

function syncFromLayers(layers: ReadonlyArray<CanvasRuntimeLayerProjectionSource>): void {
  const visibility = { ...layerVisibility.value }
  const locks = { ...layerLockState.value }
  const opacities = { ...layerOpacity.value }

  for (const layer of layers) {
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
