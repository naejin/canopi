import type { CanopiFile } from '../../types/design'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../plant-spacing-interval'
import type { CanvasRuntimeDocumentMetadata } from './runtime'

export interface CanvasRuntimeLayerProjectionSource {
  readonly name: string
  readonly visible: boolean
  readonly locked: boolean
  readonly opacity: number
}

export interface CanvasRuntimeChromeSettingsSnapshot {
  readonly gridVisible: boolean
  readonly rulersVisible: boolean
}

export interface CanvasRuntimeCleanStateAdapter {
  setCanvasClean(clean: boolean): void
}

export interface CanvasRuntimeDocumentCompositionInput {
  readonly metadata: CanvasRuntimeDocumentMetadata
  readonly document: CanopiFile
  readonly canvas: CanopiFile
}

export interface CanvasRuntimeDocumentAdapter {
  composeDocumentForSave(input: CanvasRuntimeDocumentCompositionInput): CanopiFile
}

export interface CanvasRuntimeSettingsAdapter {
  readLocale(): string
  readChromeOverlay(): CanvasRuntimeChromeSettingsSnapshot
  readSnapToGridEnabled(): boolean
  readSnapToGuidesEnabled(): boolean
  readPlantSpacingIntervalMeters(): number
  commitPlantSpacingIntervalMeters(meters: number): void
  toggleGridVisible(): void
  toggleSnapToGrid(): void
  toggleRulersVisible(): void
  subscribeTheme(onChange: () => void): () => void
  subscribeLocale(onChange: () => void): () => void
  subscribeChromeOverlay(onChange: () => void): () => void
  readonly layerProjections: CanvasRuntimeLayerProjectionAdapter
}

export interface CanvasRuntimeLayerProjectionAdapter {
  isAppOwnedLayerProjection(name: string): boolean
  syncFromLayers(layers: ReadonlyArray<CanvasRuntimeLayerProjectionSource>): void
  syncLayer(layer: CanvasRuntimeLayerProjectionSource): void
}

export interface CanvasRuntimeAppAdapter {
  readonly cleanState: CanvasRuntimeCleanStateAdapter
  readonly document: CanvasRuntimeDocumentAdapter
  readonly settings: CanvasRuntimeSettingsAdapter
}

export function createDetachedCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  let gridVisible = false
  let snapToGrid = false
  let snapToGuides = false
  let rulersVisible = false
  let plantSpacingIntervalM = FALLBACK_PLANT_SPACING_INTERVAL_M
  const layerProjections = new Map<string, CanvasRuntimeLayerProjectionSource>()

  return {
    cleanState: {
      setCanvasClean: () => {},
    },
    document: {
      composeDocumentForSave: composeDetachedCanvasDocument,
    },
    settings: {
      readLocale: () => 'en',
      readChromeOverlay: () => ({ gridVisible, rulersVisible }),
      readSnapToGridEnabled: () => snapToGrid,
      readSnapToGuidesEnabled: () => snapToGuides,
      readPlantSpacingIntervalMeters: () => plantSpacingIntervalM,
      commitPlantSpacingIntervalMeters: (meters) => {
        plantSpacingIntervalM = meters
      },
      toggleGridVisible: () => {
        gridVisible = !gridVisible
      },
      toggleSnapToGrid: () => {
        snapToGrid = !snapToGrid
      },
      toggleRulersVisible: () => {
        rulersVisible = !rulersVisible
      },
      subscribeTheme: subscribeImmediately,
      subscribeLocale: subscribeImmediately,
      subscribeChromeOverlay: subscribeImmediately,
      layerProjections: {
        isAppOwnedLayerProjection: () => false,
        syncFromLayers: (layers) => {
          layerProjections.clear()
          for (const layer of layers) layerProjections.set(layer.name, layer)
        },
        syncLayer: (layer) => {
          layerProjections.set(layer.name, layer)
        },
      },
    },
  }
}

function subscribeImmediately(onChange: () => void): () => void {
  onChange()
  return () => {}
}

function composeDetachedCanvasDocument({
  metadata,
  document,
  canvas,
}: CanvasRuntimeDocumentCompositionInput): CanopiFile {
  return {
    ...document,
    ...canvas,
    name: metadata.name,
    description: metadata.description ?? document.description ?? null,
    location: normalizeMetadataLocation(metadata.location, document.location),
    north_bearing_deg: metadata.northBearingDeg ?? document.north_bearing_deg ?? 0,
    consortiums: document.consortiums,
    timeline: document.timeline,
    budget: document.budget,
    budget_currency: document.budget_currency,
    created_at: document.created_at,
    extra: composeDetachedDocumentExtra(document.extra, canvas.extra),
  }
}

function composeDetachedDocumentExtra(
  documentExtra: CanopiFile['extra'],
  canvasExtra: CanopiFile['extra'],
): Record<string, unknown> {
  const nextExtra = normalizeDetachedExtra(documentExtra)
  const sceneExtra = normalizeDetachedExtra(canvasExtra)

  if (Object.prototype.hasOwnProperty.call(sceneExtra, 'guides')) {
    nextExtra.guides = sceneExtra.guides
  } else {
    delete nextExtra.guides
  }

  return nextExtra
}

function normalizeDetachedExtra(extra: CanopiFile['extra']): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {}
  return { ...extra }
}

function normalizeMetadataLocation(
  location: CanvasRuntimeDocumentMetadata['location'],
  fallback: CanopiFile['location'],
): CanopiFile['location'] {
  if (!location) return fallback ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitude_m: location.altitude_m ?? null,
  }
}
