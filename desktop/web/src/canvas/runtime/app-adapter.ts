import type { CanopiFile } from '../../types/design'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../plant-spacing-interval'
import type {
  CanvasPlantLabelSource,
  CanvasSpeciesPresentationCache,
} from './presentation-data'
import type { ScenePersistedState, ScenePoint } from './scene'
import type { CanvasMapBackdrop } from './scene-visuals'
import type { PlantDisplay } from './plant-display'
import type {
  CanvasDesignObjectSelectionModel,
  CanvasRuntimeDocumentMetadata,
  CanvasSceneEditCommandSurface,
} from './runtime'
import { SCENE_OWNED_EXTRA_KEYS } from './scene-extra-keys'

export interface CanvasRuntimeLayerProjectionSource {
  readonly name: string
  readonly visible: boolean
  readonly locked: boolean
  readonly opacity: number
}

interface CanvasRuntimeChromeSettingsSnapshot {
  readonly gridVisible: boolean
  readonly rulersVisible: boolean
  /** The Design's ruler guides; the app hides them while it presents the map. */
  readonly guidesVisible: boolean
}

interface CanvasRuntimeCleanStateAdapter {
  setCanvasClean(clean: boolean): void
}

export interface CanvasRuntimeDocumentCompositionInput {
  readonly metadata: CanvasRuntimeDocumentMetadata
  readonly document: CanopiFile
  readonly canvas: CanopiFile
}

interface CanvasRuntimeDocumentAdapter {
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
  | 'renameZone'
  | 'rotateSelected'
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
  /**
   * Place plants here (the empty map): arms Place plants and places the
   * chosen species at `world`, or, with none chosen yet, the next one picked.
   */
  readonly placePlantsAt?: (world: ScenePoint) => void
  /** Gives keyboard focus back to the map. */
  returnFocus(): void
  /**
   * The app calls this once the request's menu has closed, however it
   * closed: a command, Esc or Tab (before returnFocus), a press or focus
   * elsewhere, a resize, a scroll, a newer request or the runtime's own
   * close. The runtime's menu state follows it.
   */
  closed?(): void
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

/** Settings › Canvas › Scroll wheel: a plain wheel zooms or pans the map. */
export type CanvasScrollWheelSetting = 'zoom' | 'pan'

export interface CanvasRuntimeSettingsAdapter {
  readLocale(): string
  readChromeOverlay(): CanvasRuntimeChromeSettingsSnapshot
  readSnapToGridEnabled(): boolean
  readSnapToGuidesEnabled(): boolean
  /** Settings › Canvas › Scroll wheel: what a plain wheel does; pinch and Ctrl wheel always zoom. */
  readScrollWheel(): CanvasScrollWheelSetting
  readPlantSpacingIntervalMeters(): number
  /** Where a new or empty Design opens: an overview of the app's last view (zoom capped by the app), if any. */
  readLastView?(): { readonly lon: number; readonly lat: number; readonly zoom: number } | null
  commitPlantSpacingIntervalMeters(meters: number): void
  toggleGridVisible(): void
  toggleSnapToGrid(): void
  toggleRulersVisible(): void
  subscribeTheme(onChange: () => void): () => void
  subscribeLocale(onChange: () => void): () => void
  subscribeChromeOverlay(onChange: () => void): () => void
  /** Calls `onChange` now and whenever the map background under the Design changes. */
  subscribeMapBackdrop(onChange: (backdrop: CanvasMapBackdrop) => void): () => void
  readonly layerProjections: CanvasRuntimeLayerProjectionAdapter
}

export interface CanvasRuntimeLayerProjectionAdapter {
  syncFromLayers(layers: ReadonlyArray<CanvasRuntimeLayerProjectionSource>): void
  syncLayer(layer: CanvasRuntimeLayerProjectionSource): void
}

/** Display on the map: how plants are coloured, sized, outlined and labelled. */
export interface CanvasRuntimePlantDisplayAdapter {
  /** Calls `onChange` now and whenever the display changes. */
  subscribe(onChange: (display: PlantDisplay) => void): () => void
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
  /** Absent in a detached runtime, which draws the default display. */
  readonly plantDisplay?: CanvasRuntimePlantDisplayAdapter
  readonly settings: CanvasRuntimeSettingsAdapter
  readonly translate: CanvasRuntimeTranslator
  /** How ToolHostDeps.focus leaves the runtime: app/canvas-runtime/app-adapter.ts passes the FocusOwner; absent (a
   *  detached runtime), interaction-session.ts focuses its host itself. */
  readonly focus?: CanvasFocusPort
}

/** How a tool's focus request (ToolEffects.requestFocus) leaves the runtime. The FocusOwner implements it. */
export interface CanvasFocusPort {
  focusMap(reason: 'tool-requested' | 'text-entry-closed'): void
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
      readChromeOverlay: () => ({ gridVisible, rulersVisible, guidesVisible: true }),
      readSnapToGridEnabled: () => snapToGrid,
      readSnapToGuidesEnabled: () => snapToGuides,
      readScrollWheel: () => 'zoom',
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
      subscribeMapBackdrop: (onChange) => {
        onChange('basemap')
        return () => {}
      },
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

/**
 * Scene-owned `extra` keys come from the scene, every other key from the
 * document. The app composer (app/contracts/document.ts) applies the same
 * rule with the format's owner table; this is the detached runtime's.
 */
function composeDetachedDocumentExtra(
  documentExtra: CanopiFile['extra'],
  canvasExtra: CanopiFile['extra'],
): Record<string, unknown> {
  const nextExtra = normalizeDetachedExtra(documentExtra)
  const sceneExtra = normalizeDetachedExtra(canvasExtra)

  for (const key of SCENE_OWNED_EXTRA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sceneExtra, key)) {
      nextExtra[key] = sceneExtra[key]
    } else {
      delete nextExtra[key]
    }
  }

  return nextExtra
}

function normalizeDetachedExtra(extra: CanopiFile['extra']): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {}
  return { ...extra }
}
