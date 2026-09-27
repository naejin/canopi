import type { CanopiFile } from '../../types/design'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../plant-spacing-interval'
import type {
  CanvasPlantLabelSource,
  CanvasSpeciesPresentationCache,
} from './presentation-data'
import type { ScenePersistedState, ScenePoint } from './scene'
import type {
  CanvasDesignObjectSelectionModel,
  CanvasRuntimeDocumentMetadata,
  CanvasSceneEditCommandSurface,
} from './runtime'

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

export interface CanvasRuntimeSavedObjectStampCapture {
  readonly scene: ScenePersistedState
  readonly selection: CanvasDesignObjectSelectionModel
  readonly localizedCommonNames: ReadonlyMap<string, string | null>
}

export interface CanvasRuntimeSavedObjectStampAdapter {
  saveCurrentSelection(capture: CanvasRuntimeSavedObjectStampCapture): void | Promise<unknown>
}

/** The scene edits a right-click menu may run; there is no other mutation path. */
export type CanvasContextMenuCommands = Pick<
  CanvasSceneEditCommandSurface,
  | 'copy'
  | 'pasteAt'
  | 'canPaste'
  | 'duplicateSelected'
  | 'toggleSelectedPlantNamePins'
  | 'deleteSelected'
  | 'selectAll'
  | 'selectSameSpecies'
  | 'bringToFront'
  | 'sendToBack'
  | 'lockSelected'
  | 'unlockSelected'
  | 'groupSelected'
  | 'ungroupSelected'
>

/** A viewport (client) rectangle; a pointer is a rectangle of zero size. */
export interface CanvasContextMenuAnchor {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface CanvasContextMenuRequest {
  /** The menu opens below and right of this rectangle, flipping to stay in view. */
  readonly anchor: CanvasContextMenuAnchor
  /** Where Paste puts the clipboard, in the session plane. */
  readonly world: ScenePoint
  /**
   * The selection the menu acts on (already retargeted to the right-clicked
   * object), or `null` for the empty map.
   */
  readonly selection: CanvasDesignObjectSelectionModel | null
  readonly commands: CanvasContextMenuCommands
  /** Present only in an edition that keeps saved stamps. */
  readonly saveSelectionAsObjectStamp?: () => void
  /** Gives keyboard focus back to the map. */
  returnFocus(): void
}

/**
 * The right-click menu is app chrome: the runtime decides what it acts on and
 * where it opens, the app renders it and runs its commands on `commands`.
 */
export interface CanvasRuntimeContextMenuAdapter {
  open(request: CanvasContextMenuRequest): void
  /** Closes this request's menu if it is still the open one. */
  close(request: CanvasContextMenuRequest): void
}

export interface CanvasRuntimeSettingsAdapter {
  readLocale(): string
  readChromeOverlay(): CanvasRuntimeChromeSettingsSnapshot
  readSnapToGridEnabled(): boolean
  readSnapToGuidesEnabled(): boolean
  readPlantSpacingIntervalMeters(): number
  /** Where a new or empty Design opens: the app's last view, if any. */
  readLastView?(): { readonly lon: number; readonly lat: number; readonly zoom: number } | null
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
  syncFromLayers(layers: ReadonlyArray<CanvasRuntimeLayerProjectionSource>): void
  syncLayer(layer: CanvasRuntimeLayerProjectionSource): void
}

export interface CanvasRuntimePresentationDataAdapter {
  readonly plantLabels?: CanvasPlantLabelSource
  readonly speciesCache?: CanvasSpeciesPresentationCache
}

export type CanvasRuntimeTranslator = (
  key: string,
  options?: Readonly<Record<string, unknown>>,
) => string

export interface CanvasRuntimeAppAdapter {
  readonly cleanState: CanvasRuntimeCleanStateAdapter
  readonly document: CanvasRuntimeDocumentAdapter
  readonly savedObjectStamps?: CanvasRuntimeSavedObjectStampAdapter
  /** Absent in a detached runtime, where right-click only suppresses the native menu. */
  readonly contextMenu?: CanvasRuntimeContextMenuAdapter
  /**
   * Numeric inspection hook, when a surface has inspection active.
   *
   * Injected rather than imported so the generic canvas runtime stays
   * independent of the LiDAR feature, and consulted per gesture so a
   * session can be installed and released without rebuilding the runtime.
   * `undefined` means nothing is inspecting and the click is ordinary.
   */
  readonly tryInspectAt?: (point: { readonly x: number; readonly y: number }) => boolean
  readonly presentationData?: CanvasRuntimePresentationDataAdapter
  readonly settings: CanvasRuntimeSettingsAdapter
  readonly translate: CanvasRuntimeTranslator
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
    translate: detachedCanvasRuntimeTranslator,
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

function detachedCanvasRuntimeTranslator(
  key: string,
  options?: Readonly<Record<string, unknown>>,
): string {
  return typeof options?.defaultValue === 'string' ? options.defaultValue : key
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
