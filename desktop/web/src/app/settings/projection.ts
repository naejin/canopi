import { batch } from '@preact/signals'
import type { BasemapStyle } from '../../generated/contracts'
import type { Locale, Settings, Theme } from '../../types/settings'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../../canvas/plant-spacing-interval'
import { normalizeBasemapStyle } from '../../maplibre/config'
import {
  contourIntervalMeters,
  snapToGridEnabled,
  snapToGuidesEnabled,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../canvas-settings/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  MIN_BOTTOM_PANEL_HEIGHT,
  type BottomPanelHeightPreferences,
  type BottomPanelTab,
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
  createDefaultBottomPanelHeights,
} from '../canvas-settings/bottom-panel-state'
import { sidePanelWidth } from '../shell/state'
import {
  DEFAULT_SAVED_STAMPS_FRAME_HEIGHT,
  MIN_FAVORITES_FRAME_HEIGHT,
  autoSaveIntervalMs,
  basemapStyle,
  locale,
  plantSpacingIntervalM,
  savedStampsFrameHeight,
  theme,
} from './state'
import type { SettingsPlatformAdapter } from './platform-adapter'

export type SettingsPersistMode = 'immediate' | 'queued' | 'none'

export interface SettingsProjectionDraft {
  locale: Locale
  theme: Theme
  basemapStyle: BasemapStyle
  snapToGrid: boolean
  snapToGuides: boolean
  autoSaveIntervalMs: number
  plantSpacingIntervalM: number
  sidePanel: {
    width: number | null
  }
  savedStamps: {
    frameHeight: number
  }
  bottomPanel: {
    open: boolean
    heights: BottomPanelHeightPreferences
    tab: BottomPanelTab
  }
  mapLayers: {
    baseVisible: boolean
    baseOpacity: number
    contoursVisible: boolean
    contoursOpacity: number
    contourIntervalMeters: number
    hillshadeVisible: boolean
    hillshadeOpacity: number
  }
}

interface MutateSettingsProjectionOptions {
  persist?: SettingsPersistMode
  delayMs?: number
}

export interface SettingsProjectionInstallation {
  readonly ready: Promise<void>
  dispose(): void
}

interface ActiveSettingsProjection {
  readonly adapter: SettingsPlatformAdapter
  disposed: boolean
  retiring: boolean
  durable: Settings | null
  persistenceRequired: boolean
  requested: Settings | null
  saving: Settings | null
  queuedPersistTimer: ReturnType<typeof globalThis.setTimeout> | null
  drainPromise: Promise<void> | null
  draining: boolean
  retryBlocked: boolean
  persistenceError: unknown | null
  pendingHydrationPatch: Partial<Settings>
  pendingHydrationPersistence: boolean
  readonly fallback: Settings
  readonly retired: Promise<void>
  readonly resolveRetired: () => void
  ready: Promise<void> | null
}

interface PendingHydrationIntent {
  readonly fallback: Settings
  readonly patch: Partial<Settings>
  readonly persist: boolean
}

const DEFAULT_QUEUED_PERSIST_DELAY_MS = 160
const DEFAULT_BOTTOM_PANEL_TAB: BottomPanelTab = 'budget'
const MIN_SIDE_PANEL_WIDTH = 320

let sourceSettings: Settings | null = null
let activeSettingsProjection: ActiveSettingsProjection | null = null
let pendingSettingsRetirement: Promise<void> | null = null
let pendingHydrationIntent: PendingHydrationIntent | null = null

function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeContourInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

function normalizePositiveMeters(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function normalizeSidePanelWidth(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.round(value))
}

function normalizeSavedStampsFrameHeight(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_SAVED_STAMPS_FRAME_HEIGHT
  return Math.max(MIN_FAVORITES_FRAME_HEIGHT, Math.round(value))
}

function normalizeBottomPanelHeight(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.round(value))
}

function normalizeBottomPanelHeights(
  heights: BottomPanelHeightPreferences,
): BottomPanelHeightPreferences {
  return {
    timeline: normalizeBottomPanelHeight(heights.timeline),
    budget: normalizeBottomPanelHeight(heights.budget),
    consortium: normalizeBottomPanelHeight(heights.consortium),
  }
}

function normalizeTheme(value: Theme): Theme {
  return value === 'dark' ? 'dark' : 'light'
}

function normalizeBottomPanelTab(value: BottomPanelTab): BottomPanelTab {
  return VISIBLE_BOTTOM_PANEL_TABS.includes(value) ? value : DEFAULT_BOTTOM_PANEL_TAB
}

function createDraftFromProjection(): SettingsProjectionDraft {
  return {
    locale: locale.value,
    theme: theme.value,
    basemapStyle: basemapStyle.value,
    snapToGrid: snapToGridEnabled.value,
    snapToGuides: snapToGuidesEnabled.value,
    autoSaveIntervalMs: autoSaveIntervalMs.value,
    plantSpacingIntervalM: plantSpacingIntervalM.value,
    sidePanel: {
      width: sidePanelWidth.value,
    },
    savedStamps: {
      frameHeight: savedStampsFrameHeight.value,
    },
    bottomPanel: {
      open: bottomPanelOpen.value,
      heights: { ...bottomPanelHeights.value },
      tab: bottomPanelTab.value,
    },
    mapLayers: {
      baseVisible: layerVisibility.value.base ?? true,
      baseOpacity: layerOpacity.value.base ?? 1,
      contoursVisible: layerVisibility.value.contours ?? false,
      contoursOpacity: layerOpacity.value.contours ?? 1,
      contourIntervalMeters: contourIntervalMeters.value,
      hillshadeVisible: hillshadeVisible.value,
      hillshadeOpacity: hillshadeOpacity.value,
    },
  }
}

function normalizeDraft(draft: SettingsProjectionDraft): SettingsProjectionDraft {
  return {
    locale: draft.locale,
    theme: normalizeTheme(draft.theme),
    basemapStyle: normalizeBasemapStyle(draft.basemapStyle),
    snapToGrid: draft.snapToGrid,
    snapToGuides: draft.snapToGuides,
    autoSaveIntervalMs: Math.max(0, Math.round(draft.autoSaveIntervalMs)),
    plantSpacingIntervalM: normalizePositiveMeters(
      draft.plantSpacingIntervalM,
      FALLBACK_PLANT_SPACING_INTERVAL_M,
    ),
    sidePanel: {
      width: normalizeSidePanelWidth(draft.sidePanel.width),
    },
    savedStamps: {
      frameHeight: normalizeSavedStampsFrameHeight(draft.savedStamps.frameHeight),
    },
    bottomPanel: {
      open: draft.bottomPanel.open,
      heights: normalizeBottomPanelHeights(draft.bottomPanel.heights),
      tab: normalizeBottomPanelTab(draft.bottomPanel.tab),
    },
    mapLayers: {
      baseVisible: draft.mapLayers.baseVisible,
      baseOpacity: clampUnitInterval(draft.mapLayers.baseOpacity, 1),
      contoursVisible: draft.mapLayers.contoursVisible,
      contoursOpacity: clampUnitInterval(draft.mapLayers.contoursOpacity, 1),
      contourIntervalMeters: normalizeContourInterval(draft.mapLayers.contourIntervalMeters, 0),
      hillshadeVisible: draft.mapLayers.hillshadeVisible,
      hillshadeOpacity: clampUnitInterval(draft.mapLayers.hillshadeOpacity, 0.55),
    },
  }
}

function applyDraftToProjection(draft: SettingsProjectionDraft): void {
  batch(() => {
    locale.value = draft.locale
    theme.value = draft.theme
    basemapStyle.value = draft.basemapStyle
    snapToGridEnabled.value = draft.snapToGrid
    snapToGuidesEnabled.value = draft.snapToGuides
    autoSaveIntervalMs.value = draft.autoSaveIntervalMs
    plantSpacingIntervalM.value = draft.plantSpacingIntervalM
    sidePanelWidth.value = draft.sidePanel.width
    savedStampsFrameHeight.value = draft.savedStamps.frameHeight
    bottomPanelOpen.value = draft.bottomPanel.open
    bottomPanelHeights.value = draft.bottomPanel.heights
    bottomPanelTab.value = draft.bottomPanel.tab
    layerVisibility.value = {
      ...layerVisibility.value,
      base: draft.mapLayers.baseVisible,
      contours: draft.mapLayers.contoursVisible,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      base: draft.mapLayers.baseOpacity,
      contours: draft.mapLayers.contoursOpacity,
    }
    contourIntervalMeters.value = draft.mapLayers.contourIntervalMeters
    hillshadeVisible.value = draft.mapLayers.hillshadeVisible
    hillshadeOpacity.value = draft.mapLayers.hillshadeOpacity
  })
}

function settingsFromDraft(draft: SettingsProjectionDraft): Settings {
  return {
    locale: draft.locale,
    theme: draft.theme,
    snap_to_grid: draft.snapToGrid,
    snap_to_guides: draft.snapToGuides,
    auto_save_interval_s: Math.round(draft.autoSaveIntervalMs / 1000),
    plant_spacing_interval_m: draft.plantSpacingIntervalM,
    side_panel_width: draft.sidePanel.width,
    saved_stamps_frame_height: draft.savedStamps.frameHeight,
    bottom_panel_open: draft.bottomPanel.open,
    bottom_panel_timeline_height: draft.bottomPanel.heights.timeline,
    bottom_panel_budget_height: draft.bottomPanel.heights.budget,
    bottom_panel_consortium_height: draft.bottomPanel.heights.consortium,
    bottom_panel_tab: draft.bottomPanel.tab,
    map_layer_visible: draft.mapLayers.baseVisible,
    map_style: draft.basemapStyle,
    map_opacity: draft.mapLayers.baseOpacity,
    contour_visible: draft.mapLayers.contoursVisible,
    contour_opacity: draft.mapLayers.contoursOpacity,
    contour_interval: draft.mapLayers.contourIntervalMeters,
    hillshade_visible: draft.mapLayers.hillshadeVisible,
    hillshade_opacity: draft.mapLayers.hillshadeOpacity,
  }
}

function settingsEqual(left: Settings, right: Settings): boolean {
  const leftKeys = Object.keys(left) as Array<keyof Settings>
  if (leftKeys.length !== Object.keys(right).length) return false

  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key])
  ))
}

function currentSettingsSnapshot(): Settings {
  return settingsFromDraft(normalizeDraft(createDraftFromProjection()))
}

function projectSettingsToSignals(settings: Settings): Settings {
  const draft = normalizeDraft({
    locale: settings.locale,
    theme: settings.theme,
    basemapStyle: normalizeBasemapStyle(settings.map_style),
    snapToGrid: settings.snap_to_grid,
    snapToGuides: settings.snap_to_guides,
    autoSaveIntervalMs: settings.auto_save_interval_s * 1000,
    plantSpacingIntervalM: settings.plant_spacing_interval_m,
    sidePanel: {
      width: settings.side_panel_width,
    },
    savedStamps: {
      frameHeight: normalizeSavedStampsFrameHeight(settings.saved_stamps_frame_height),
    },
    bottomPanel: {
      open: settings.bottom_panel_open,
      heights: {
        ...createDefaultBottomPanelHeights(),
        timeline: settings.bottom_panel_timeline_height,
        budget: settings.bottom_panel_budget_height,
        consortium: settings.bottom_panel_consortium_height,
      },
      tab: normalizeBottomPanelTab(settings.bottom_panel_tab as BottomPanelTab),
    },
    mapLayers: {
      baseVisible: settings.map_layer_visible,
      baseOpacity: settings.map_opacity,
      contoursVisible: settings.contour_visible,
      contoursOpacity: settings.contour_opacity,
      contourIntervalMeters: settings.contour_interval,
      hillshadeVisible: settings.hillshade_visible,
      hillshadeOpacity: settings.hillshade_opacity,
    },
  })
  applyDraftToProjection(draft)
  return settingsFromDraft(draft)
}

function clearQueuedPersist(projection: ActiveSettingsProjection | null): void {
  if (!projection || projection.queuedPersistTimer === null) return
  globalThis.clearTimeout(projection.queuedPersistTimer)
  projection.queuedPersistTimer = null
}

async function drainPersistence(projection: ActiveSettingsProjection): Promise<void> {
  while (!projection.disposed && projection.requested) {
    const next = projection.requested
    projection.requested = null
    projection.saving = next

    try {
      await projection.adapter.save(next)
    } catch (error) {
      projection.saving = null
      if (!projection.requested) projection.requested = next
      projection.retryBlocked = true
      projection.persistenceError = error
      console.error('Failed to persist settings:', error)
      return
    }

    if (projection.disposed) return
    projection.durable = next
    projection.persistenceRequired = false
    projection.saving = null
    if (projection.requested && settingsEqual(projection.requested, next)) {
      projection.requested = null
    }
  }
}

function ensurePersistenceDrain(projection: ActiveSettingsProjection): void {
  if (
    projection.disposed
    || projection.retryBlocked
    || projection.draining
    || !projection.requested
  ) return

  projection.draining = true
  const drainPromise = drainPersistence(projection)
  projection.drainPromise = drainPromise
  const finishDrain = () => {
    if (projection.drainPromise !== drainPromise) return
    projection.drainPromise = null
    projection.draining = false
    if (projection.requested && !projection.retryBlocked) {
      ensurePersistenceDrain(projection)
    }
  }
  void drainPromise.then(finishDrain, finishDrain)
}

function admitPersistenceSnapshot(
  projection: ActiveSettingsProjection,
  settings: Settings,
): void {
  if (projection.disposed || projection.retiring) return
  projection.retryBlocked = false
  projection.persistenceError = null

  if (
    !projection.saving
    && projection.durable
    && !projection.persistenceRequired
    && settingsEqual(settings, projection.durable)
  ) {
    projection.requested = null
    return
  }

  projection.requested = settings
  ensurePersistenceDrain(projection)
}

async function waitForPersistence(projection: ActiveSettingsProjection): Promise<void> {
  while (projection.draining) {
    const drainPromise = projection.drainPromise
    if (drainPromise) {
      await drainPromise
    } else {
      await Promise.resolve()
    }
  }

  if (projection.retryBlocked) {
    throw projection.persistenceError ?? new Error('Failed to persist settings')
  }
}

function persistProjection(mode: SettingsPersistMode, delayMs = DEFAULT_QUEUED_PERSIST_DELAY_MS): void {
  if (mode === 'none' || !sourceSettings) return
  const projection = activeSettingsProjection
  if (!projection || projection.disposed || !projection.durable) return

  const updated = snapshotSettingsProjection()
  if (
    !projection.saving
    && !projection.requested
    && !projection.persistenceRequired
    && settingsEqual(updated, projection.durable)
  ) {
    clearQueuedPersist(projection)
    return
  }

  if (mode === 'immediate') {
    clearQueuedPersist(projection)
    admitPersistenceSnapshot(projection, updated)
    return
  }

  clearQueuedPersist(projection)
  projection.queuedPersistTimer = globalThis.setTimeout(() => {
    projection.queuedPersistTimer = null
    if (
      projection !== activeSettingsProjection
      || projection.disposed
      || !sourceSettings
      || !projection.durable
    ) return

    const queued = snapshotSettingsProjection()
    admitPersistenceSnapshot(projection, queued)
  }, delayMs)
}

function preservePendingHydrationIntent(projection: ActiveSettingsProjection): void {
  if (projection.durable || !projection.pendingHydrationPersistence) return
  pendingHydrationIntent = {
    fallback: projection.fallback,
    patch: { ...projection.pendingHydrationPatch },
    persist: true,
  }
}

function handOffFailedRetirement(projection: ActiveSettingsProjection): void {
  const desired = projection.requested ?? projection.saving
  if (!desired) return

  const successor = activeSettingsProjection
  if (successor && successor !== projection && !successor.disposed && !successor.retiring) {
    if (!successor.durable) {
      successor.pendingHydrationPatch = {
        ...desired,
        ...successor.pendingHydrationPatch,
      }
      successor.pendingHydrationPersistence = true
      return
    }

    admitPersistenceSnapshot(successor, currentSettingsSnapshot())
    return
  }

  const pending = pendingHydrationIntent
  pendingHydrationIntent = {
    fallback: pending?.fallback ?? desired,
    patch: {
      ...desired,
      ...pending?.patch,
    },
    persist: true,
  }
}

function trackSettingsRetirement(retirement: Promise<void>): void {
  const previous = pendingSettingsRetirement
  const tracked = previous
    ? Promise.all([previous, retirement]).then(() => undefined)
    : retirement
  pendingSettingsRetirement = tracked
  void tracked.then(() => {
    if (pendingSettingsRetirement === tracked) pendingSettingsRetirement = null
  })
}

function retireSettingsProjection(projection: ActiveSettingsProjection): void {
  if (projection.disposed || projection.retiring) return

  preservePendingHydrationIntent(projection)
  clearQueuedPersist(projection)
  if (activeSettingsProjection === projection && projection.durable && sourceSettings) {
    admitPersistenceSnapshot(projection, currentSettingsSnapshot())
  }
  projection.retiring = true
  projection.resolveRetired()
  if (activeSettingsProjection === projection) {
    activeSettingsProjection = null
    sourceSettings = null
  }

  const finishRetirement = () => {
    projection.disposed = true
    projection.requested = null
    projection.saving = null
  }
  if (!projection.draining) {
    finishRetirement()
    return
  }

  const retirement = waitForPersistence(projection)
    .catch(() => handOffFailedRetirement(projection))
    .then(finishRetirement)
  trackSettingsRetirement(retirement)
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function'
}

function applyLoadedSettings(
  projection: ActiveSettingsProjection,
  settings: Settings,
): void {
  if (activeSettingsProjection !== projection || projection.retiring || projection.disposed) return

  clearQueuedPersist(projection)
  const durable = projectSettingsToSignals(settings)
  sourceSettings = durable
  projection.durable = durable
  projection.persistenceRequired = false
  projection.requested = null
  projection.retryBlocked = false
  projection.persistenceError = null

  const pendingPatch = projection.pendingHydrationPatch
  const shouldPersist = projection.pendingHydrationPersistence
  projection.pendingHydrationPatch = {}
  projection.pendingHydrationPersistence = false
  if (Object.keys(pendingPatch).length === 0) return

  const desired = projectSettingsToSignals({ ...durable, ...pendingPatch })
  sourceSettings = durable
  if (shouldPersist && !settingsEqual(desired, durable)) {
    admitPersistenceSnapshot(projection, desired)
  }
}

function recoverFromSettingsLoadFailure(projection: ActiveSettingsProjection): void {
  if (activeSettingsProjection !== projection || projection.retiring || projection.disposed) return

  const shouldPersist = projection.pendingHydrationPersistence
  projection.pendingHydrationPatch = {}
  projection.pendingHydrationPersistence = false
  projection.durable = projection.fallback
  projection.persistenceRequired = shouldPersist
  sourceSettings = projection.fallback
  projection.retryBlocked = false
  projection.persistenceError = null

  const desired = currentSettingsSnapshot()
  if (shouldPersist) {
    admitPersistenceSnapshot(projection, desired)
  }
}

function loadSettingsProjection(projection: ActiveSettingsProjection): void | Promise<void> {
  if (activeSettingsProjection !== projection || projection.retiring || projection.disposed) return

  let loaded: Settings | Promise<Settings>
  try {
    loaded = projection.adapter.load()
  } catch (error) {
    recoverFromSettingsLoadFailure(projection)
    return Promise.reject(error)
  }

  if (!isPromiseLike(loaded)) {
    applyLoadedSettings(projection, loaded)
    return
  }

  return Promise.resolve(loaded).then(
    (settings) => applyLoadedSettings(projection, settings),
    (error) => {
      recoverFromSettingsLoadFailure(projection)
      throw error
    },
  )
}

export function installSettingsProjection(
  adapter: SettingsPlatformAdapter,
): SettingsProjectionInstallation {
  if (activeSettingsProjection) retireSettingsProjection(activeSettingsProjection)

  const inheritedIntent = pendingHydrationIntent
  pendingHydrationIntent = null
  const fallback = inheritedIntent?.fallback ?? currentSettingsSnapshot()
  let resolveRetired!: () => void
  const retired = new Promise<void>((resolve) => {
    resolveRetired = resolve
  })

  const projection: ActiveSettingsProjection = {
    adapter,
    disposed: false,
    retiring: false,
    durable: null,
    persistenceRequired: false,
    requested: null,
    saving: null,
    queuedPersistTimer: null,
    drainPromise: null,
    draining: false,
    retryBlocked: false,
    persistenceError: null,
    pendingHydrationPatch: { ...inheritedIntent?.patch },
    pendingHydrationPersistence: inheritedIntent?.persist ?? false,
    fallback,
    retired,
    resolveRetired,
    ready: null,
  }
  activeSettingsProjection = projection
  sourceSettings = null

  const retirement = pendingSettingsRetirement
  const loaded = retirement
    ? retirement.then(() => loadSettingsProjection(projection))
    : loadSettingsProjection(projection)
  const ready = isPromiseLike(loaded) ? Promise.resolve(loaded).then(() => undefined) : Promise.resolve()
  projection.ready = ready

  return {
    ready,
    dispose: () => retireSettingsProjection(projection),
  }
}

export function hydrateSettingsProjection(settings: Settings): void {
  const projection = activeSettingsProjection
  clearQueuedPersist(projection)
  const normalizedSettings = projectSettingsToSignals(settings)
  sourceSettings = normalizedSettings
  if (projection && !projection.disposed) {
    projection.durable = normalizedSettings
    projection.persistenceRequired = false
    projection.requested = null
    projection.retryBlocked = false
    projection.persistenceError = null
    projection.pendingHydrationPatch = {}
    projection.pendingHydrationPersistence = false
  }
}

export function primeThemeProjectionFromFirstPaintCache(cachedTheme: Theme): void {
  theme.value = normalizeTheme(cachedTheme)
}

export function snapshotSettingsProjection(): Settings {
  if (!sourceSettings) {
    throw new Error('Cannot snapshot settings before settings bootstrap')
  }
  return currentSettingsSnapshot()
}

export function mutateSettingsProjection(
  mutate: (draft: SettingsProjectionDraft) => void,
  options: MutateSettingsProjectionOptions = {},
): void {
  const draft = createDraftFromProjection()
  const before = settingsFromDraft(normalizeDraft(draft))
  mutate(draft)
  const normalized = normalizeDraft(draft)
  applyDraftToProjection(normalized)
  const persistMode = options.persist ?? 'immediate'
  const projection = activeSettingsProjection
  if (projection && !projection.durable && persistMode !== 'none') {
    const updated = settingsFromDraft(normalized)
    let changed = false
    for (const key of Object.keys(updated) as Array<keyof Settings>) {
      if (!Object.is(before[key], updated[key])) {
        ;(projection.pendingHydrationPatch as Record<string, unknown>)[key] = updated[key]
        changed = true
      }
    }
    if (changed) projection.pendingHydrationPersistence = true
    return
  }

  persistProjection(persistMode, options.delayMs)
}

export async function flushSettingsProjection(): Promise<void> {
  while (activeSettingsProjection) {
    const projection = activeSettingsProjection
    if (!projection.durable || !sourceSettings) {
      if (!projection.ready) return
      await Promise.race([
        projection.ready.catch(() => undefined),
        projection.retired,
      ])
      if (activeSettingsProjection !== projection) continue
      if (!projection.durable || !sourceSettings) return
    }

    clearQueuedPersist(projection)
    admitPersistenceSnapshot(projection, currentSettingsSnapshot())
    try {
      await waitForPersistence(projection)
    } catch (error) {
      if (activeSettingsProjection && activeSettingsProjection !== projection) continue
      throw error
    }
    if (activeSettingsProjection !== projection) continue
    const latest = currentSettingsSnapshot()
    if (
      projection.queuedPersistTimer !== null
      || projection.saving !== null
      || projection.requested !== null
      || projection.persistenceRequired
      || !projection.durable
      || !settingsEqual(latest, projection.durable)
    ) continue
    return
  }
}

export function resetSettingsProjectionForTests(): void {
  if (activeSettingsProjection) {
    activeSettingsProjection.disposed = true
    activeSettingsProjection.resolveRetired()
    clearQueuedPersist(activeSettingsProjection)
    activeSettingsProjection.requested = null
  }
  activeSettingsProjection = null
  sourceSettings = null
  pendingSettingsRetirement = null
  pendingHydrationIntent = null
}
