import { locale } from '../../state/app'
import {
  gridVisible,
  guides,
  hoveredPanelTargets,
  layerVisibility,
  lockedObjectIds,
  plantNamesRevision,
  plantSpeciesColors,
  rulersVisible,
  sceneEntityRevision,
  snapToGridEnabled,
} from '../../state/canvas'
import type { ColorByAttribute, PlantSizeMode } from '../../state/canvas'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import { normalizeHexColor } from '../plant-colors'
import { computeSelectionLabels } from './selection-labels'
import { clearCanvasSelection, setCanvasSelection } from '../session-state'
import { refreshCanvasColorCache } from '../theme-refresh'
import { CameraController, type SceneBounds } from './camera'
import { SceneChromeOverlay } from './scene-chrome'
import { SceneInteractionController } from './scene-interaction'
import { RendererHost } from './renderers'
import { createCanvas2DSceneRenderer } from './renderers/canvas2d-scene'
import { createPixiSceneRenderer } from './renderers/pixi-scene'
import type { SceneRendererContext, SceneRendererInstance, SceneRendererSnapshot } from './renderers/scene-types'
import { getAnnotationWorldBounds } from './annotation-layout'
import { SceneStore } from './scene'
import { CanvasSpeciesCache } from './species-cache'
import { CanvasPlantLabelResolver } from './plant-labels'
import {
  getSelectedAnnotationIds,
  getSelectedPlantIds,
  getSelectedTopLevelTargets,
  getSelectedZoneIds,
  getSelectionLayer,
  setsEqual,
} from './scene-runtime/selection'
import {
  applySignalBackedSceneState,
  resetTransientRuntimeState,
  syncCanvasSignalsFromScene,
  syncPresentationSignalsFromSceneSession,
} from './scene-runtime/scene-sync'
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import {
  createClipboardPayload,
  pasteClipboardPayload,
  type SceneClipboardPayload,
} from './scene-runtime/clipboard'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from './plant-presentation'
import { resolvePlantCanopySpreadM, resolvePlantStratum } from './plant-presentation'
import type {
  SceneObjectGroupEntity,
  ScenePersistedState,
} from './scene'
import { createScenePatchCommand, type SceneCommandSnapshot } from './scene-commands'
import { SceneHistory } from './scene-history'
import type { CanvasRuntime, CanvasRuntimeDocumentMetadata } from './runtime'
import { resolvePanelTargets } from '../../panel-target-resolution'

const EMPTY_PLANT_COLOR_CONTEXT: SelectedPlantColorContext = {
  plantIds: [],
  singleSpeciesCanonicalName: null,
  singleSpeciesCommonName: null,
  sharedCurrentColor: null,
  suggestedColor: null,
  singleSpeciesDefaultColor: null,
}

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export class SceneCanvasRuntime implements CanvasRuntime {
  private readonly _sceneStore = new SceneStore()
  private readonly _camera = new CameraController()
  private readonly _rendererHost = new RendererHost<SceneRendererContext, SceneRendererInstance>({
    backends: [
      createPixiSceneRenderer(),
      createCanvas2DSceneRenderer(),
    ],
  })
  private readonly _speciesCache = new CanvasSpeciesCache()
  private readonly _plantLabels = new CanvasPlantLabelResolver()
  private _container: HTMLElement | null = null
  private _chrome: SceneChromeOverlay | null = null
  private _interaction: SceneInteractionController | null = null
  private _chromeVisible = false
  private readonly _history = new SceneHistory()
  private _clipboard: SceneClipboardPayload | null = null
  private readonly _disposeEffects: Array<() => void> = []
  private _renderEpoch = 0

  constructor() {
    this._installEffects()
  }

  async init(container: HTMLElement): Promise<void> {
    this._container = container
    refreshCanvasColorCache(container)
    await this._rendererHost.initialize({ container })
    const viewport = this._camera.initialize({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
    })
    this._sceneStore.setViewport(viewport)
    this._interaction = new SceneInteractionController({
      container,
      getSceneStore: () => this._sceneStore,
      camera: this._camera,
      getSpeciesCache: () => this._speciesCache.getCache(),
      getPlantPresentationContext: (viewportScale) => this._createPlantPresentationContext(viewportScale),
      getSelection: () => this._sceneStore.session.selectedEntityIds,
      setSelection: (ids) => this._setSelection(ids),
      clearSelection: () => this._setSelection([]),
      setTool: (name) => this.setTool(name),
      render: (kind) => this._invalidate(kind),
      markDirty: (before) => this._markCanvasDirty(before, 'interaction'),
      getLocalizedCommonNames: () => this._plantLabels.getLocaleSnapshot(locale.value),
      setHoveredEntityId: (id) => {
        if (this._sceneStore.session.hoveredEntityId === id) return
        this._sceneStore.updateSession((s) => { s.hoveredEntityId = id })
        this._invalidate('scene')
      },
    })
    await this._render()
  }

  getSceneStore(): SceneStore {
    return this._sceneStore
  }

  getSelection(): Set<string> {
    return new Set(this._sceneStore.session.selectedEntityIds)
  }

  setSelection(ids: Iterable<string>): void {
    this._setSelection(ids)
    this._invalidate('scene')
  }

  clearSelection(): void {
    if (this._sceneStore.session.selectedEntityIds.size === 0) return
    this._setSelection([])
    this._invalidate('scene')
  }

  initializeViewport(): void {
    if (!this._container) return
    const viewport = this._camera.initialize({
      width: Math.max(1, this._container.clientWidth),
      height: Math.max(1, this._container.clientHeight),
    })
    this._sceneStore.setViewport(viewport)
    void this._render()
  }

  attachRulersTo(element: HTMLElement): void {
    this._chrome?.destroy()
    this._chrome = new SceneChromeOverlay(element)
    this._chrome.setGuideCreate((axis, worldPosition) => {
      this._addGuide(axis, worldPosition)
    })
    this._renderChrome()
  }

  showCanvasChrome(): void {
    this._chromeVisible = true
    this._renderChrome()
  }

  hideCanvasChrome(): void {
    this._chromeVisible = false
    this._renderChrome()
  }

  setTool(name: string): void {
    this._interaction?.setTool(name)
  }

  zoomIn(): void {
    this._sceneStore.setViewport(this._camera.zoomIn())
    this._invalidate('viewport')
  }

  zoomOut(): void {
    this._sceneStore.setViewport(this._camera.zoomOut())
    this._invalidate('viewport')
  }

  zoomToFit(): void {
    this._sceneStore.setViewport(this._camera.zoomToFit(this._sceneStore.persisted, {
      plantContext: this._createPlantPresentationContext(this._camera.viewport.scale),
    }))
    this._invalidate('viewport')
  }

  undo(): void {
    this._history.undo(this._historyRuntime())
    this._syncCanvasSignalsFromScene()
    sceneEntityRevision.value += 1
    this._invalidate('scene')
  }

  redo(): void {
    this._history.redo(this._historyRuntime())
    this._syncCanvasSignalsFromScene()
    sceneEntityRevision.value += 1
    this._invalidate('scene')
  }

  copy(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    this._clipboard = createClipboardPayload(persisted, selected)
  }

  paste(): void {
    if (!this._clipboard) return

    const before = this._captureCommandSnapshot()
    let nextSelection = new Set<string>()
    this._sceneStore.updatePersisted((draft) => {
      nextSelection = pasteClipboardPayload(this._clipboard!, draft)
    })

    if (nextSelection.size === 0) return
    this._setSelection(nextSelection)
    this._markCanvasDirty(before)
    this._invalidate('scene')
  }

  duplicateSelected(): void {
    this.copy()
    this.paste()
  }

  deleteSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return

    const before = this._captureCommandSnapshot()
    const selectedGroupIds = new Set(selected.filter((target) => target.kind === 'group').map((target) => target.id))
    const deletedPlantIds = new Set<string>()
    const deletedZoneIds = new Set<string>()
    const deletedAnnotationIds = new Set<string>()

    for (const target of selected) {
      if (target.kind === 'plant') deletedPlantIds.add(target.id)
      else if (target.kind === 'zone') deletedZoneIds.add(target.id)
      else if (target.kind === 'annotation') deletedAnnotationIds.add(target.id)
    }

    for (const group of persisted.groups) {
      if (!selectedGroupIds.has(group.id)) continue
      for (const memberId of group.memberIds) {
        if (persisted.plants.some((plant) => plant.id === memberId)) deletedPlantIds.add(memberId)
        else if (persisted.zones.some((zone) => zone.name === memberId)) deletedZoneIds.add(memberId)
        else if (persisted.annotations.some((annotation) => annotation.id === memberId)) deletedAnnotationIds.add(memberId)
      }
    }

    this._sceneStore.updatePersisted((draft) => {
      draft.plants = draft.plants.filter((plant) => !deletedPlantIds.has(plant.id))
      draft.zones = draft.zones.filter((zone) => !deletedZoneIds.has(zone.name))
      draft.annotations = draft.annotations.filter((annotation) => !deletedAnnotationIds.has(annotation.id))
      draft.groups = draft.groups
        .filter((group) => !selectedGroupIds.has(group.id))
        .map((group) => ({
          ...group,
          memberIds: group.memberIds.filter((memberId) =>
            !deletedPlantIds.has(memberId) && !deletedZoneIds.has(memberId) && !deletedAnnotationIds.has(memberId),
          ),
        }))
        .filter((group) => group.memberIds.length >= 2)
    })

    const nextLocked = new Set(lockedObjectIds.value)
    for (const id of [...deletedPlantIds, ...deletedZoneIds, ...deletedAnnotationIds, ...selectedGroupIds]) {
      nextLocked.delete(id)
    }
    lockedObjectIds.value = nextLocked
    this._setSelection([])
    this._markCanvasDirty(before)
    this._invalidate('scene')
  }

  selectAll(): void {
    const persisted = this._sceneStore.persisted
    const locked = lockedObjectIds.value
    const ids = new Set<string>()
    const groupedMemberIds = new Set(persisted.groups.flatMap((group) => group.memberIds))

    if (layerVisibility.value.plants !== false) {
      for (const plant of persisted.plants) {
        if (groupedMemberIds.has(plant.id) || locked.has(plant.id)) continue
        ids.add(plant.id)
      }
    }

    if (layerVisibility.value.zones !== false) {
      for (const zone of persisted.zones) {
        if (groupedMemberIds.has(zone.name) || locked.has(zone.name)) continue
        ids.add(zone.name)
      }
    }

    if (layerVisibility.value.annotations !== false) {
      for (const annotation of persisted.annotations) {
        if (groupedMemberIds.has(annotation.id) || locked.has(annotation.id)) continue
        ids.add(annotation.id)
      }
    }

    for (const group of persisted.groups) {
      if (layerVisibility.value[group.layer] === false || locked.has(group.id)) continue
      ids.add(group.id)
    }

    if (setsEqual(ids, this._sceneStore.session.selectedEntityIds)) return
    this._setSelection(ids)
    this._invalidate('scene')
  }

  bringToFront(): void {
    this._reorderSelected('end')
  }

  sendToBack(): void {
    this._reorderSelected('start')
  }

  lockSelected(): void {
    const selected = getSelectedTopLevelTargets(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return
    const before = this._captureCommandSnapshot()
    const nextLocked = new Set(lockedObjectIds.value)
    for (const target of selected) nextLocked.add(target.id)
    lockedObjectIds.value = nextLocked
    this._setSelection([])
    this._markCanvasDirty(before, 'lock-selected')
    this._invalidate('scene')
  }

  unlockSelected(): void {
    if (lockedObjectIds.value.size === 0) return
    const before = this._captureCommandSnapshot()
    lockedObjectIds.value = new Set()
    this._markCanvasDirty(before, 'unlock-selected')
    this._invalidate('scene')
  }

  groupSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length < 2 || selected.some((target) => target.kind === 'group')) return

    const before = this._captureCommandSnapshot()
    const layer = getSelectionLayer(selected[0]!)
    if (!selected.every((target) => getSelectionLayer(target) === layer)) return

    const memberIds = selected.map((target) => target.id)
    const plantContext = this._createPlantPresentationContext(this._camera.viewport.scale)
    const bounds = memberIds
      .map((memberId) => getMemberBounds(memberId, persisted, this._camera.viewport.scale, plantContext))
      .filter((value): value is SceneBounds => value !== null)
    if (bounds.length === 0) return

    let minX = Infinity, minY = Infinity
    for (const b of bounds) {
      if (b.minX < minX) minX = b.minX
      if (b.minY < minY) minY = b.minY
    }
    const nextGroup: SceneObjectGroupEntity = {
      kind: 'group',
      id: crypto.randomUUID(),
      name: null,
      layer,
      position: { x: minX, y: minY },
      rotationDeg: null,
      memberIds,
    }

    this._sceneStore.updatePersisted((draft) => {
      draft.groups.push(nextGroup)
    })
    this._setSelection([nextGroup.id])
    this._markCanvasDirty(before)
    this._invalidate('scene')
  }

  ungroupSelected(): void {
    const persisted = this._sceneStore.persisted
    const selectedGroupIds = new Set(
      getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
        .filter((target) => target.kind === 'group')
        .map((target) => target.id),
    )
    if (selectedGroupIds.size === 0) return

    const before = this._captureCommandSnapshot()
    const memberIds = persisted.groups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => group.memberIds)

    this._sceneStore.updatePersisted((draft) => {
      draft.groups = draft.groups.filter((group) => !selectedGroupIds.has(group.id))
    })
    this._setSelection(memberIds)
    this._markCanvasDirty(before)
    this._invalidate('scene')
  }

  toggleGrid(): void {
    gridVisible.value = !gridVisible.value
  }

  toggleSnapToGrid(): void {
    snapToGridEnabled.value = !snapToGridEnabled.value
  }

  toggleRulers(): void {
    rulersVisible.value = !rulersVisible.value
    this._invalidate('chrome')
  }

  getPlantSizeMode(): PlantSizeMode {
    return this._sceneStore.session.plantSizeMode
  }

  setPlantSizeMode(mode: PlantSizeMode): void {
    if (this._sceneStore.session.plantSizeMode === mode) return
    this._sceneStore.updateSession((session) => {
      session.plantSizeMode = mode
    })
    syncPresentationSignalsFromSceneSession(this._sceneStore)
    this._invalidate('scene')
  }

  getPlantColorByAttr(): ColorByAttribute | null {
    return this._sceneStore.session.plantColorByAttr
  }

  setPlantColorByAttr(attr: ColorByAttribute | null): void {
    if (this._sceneStore.session.plantColorByAttr === attr) return
    this._sceneStore.updateSession((session) => {
      session.plantColorByAttr = attr
    })
    syncPresentationSignalsFromSceneSession(this._sceneStore)
    this._invalidate('scene')
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    const selectedPlantIds = getSelectedPlantIds(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
    const selectedPlants = this._sceneStore.persisted.plants.filter((plant) => selectedPlantIds.has(plant.id))
    if (selectedPlants.length === 0) return EMPTY_PLANT_COLOR_CONTEXT

    const plantIds = selectedPlants.map((plant) => plant.id)
    const canonicalNames = new Set(selectedPlants.map((plant) => plant.canonicalName))
    const commonNames = new Set(
      selectedPlants
        .map((plant) => plant.commonName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
    const colors = new Set(
      selectedPlants
        .map((plant) => normalizeHexColor(plant.color))
        .filter((value): value is string => value !== null),
    )
    const hasUncolored = selectedPlants.some((plant) => normalizeHexColor(plant.color) === null)
    const singleSpeciesCanonicalName = canonicalNames.size === 1 ? [...canonicalNames][0]! : null
    const singleSpeciesCommonName = singleSpeciesCanonicalName && commonNames.size === 1
      ? [...commonNames][0]!
      : null
    const sharedCurrentColor =
      colors.size > 1 || (colors.size === 1 && hasUncolored)
        ? 'mixed'
        : colors.size === 1
          ? [...colors][0]!
          : null
    const singleSpeciesDefaultColor = singleSpeciesCanonicalName
      ? normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[singleSpeciesCanonicalName] ?? null)
      : null

    return {
      plantIds,
      singleSpeciesCanonicalName,
      singleSpeciesCommonName,
      sharedCurrentColor,
      suggestedColor: singleSpeciesCanonicalName
        ? this._speciesCache.getSuggestedPlantColor(singleSpeciesCanonicalName)
        : null,
      singleSpeciesDefaultColor,
    }
  }

  getPlacedPlants(): PlacedPlant[] {
    return this._sceneStore.toCanopiFile().plants
  }

  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this._plantLabels.getLocaleSnapshot(locale.value)
  }

  async ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean> {
    const loaded = await this._speciesCache.ensureEntries(canonicalNames, activeLocale)
    const backfilled = this._backfillPlantPresentationMetadataFromSpeciesCache()
    if (loaded || backfilled) this._invalidate('scene')
    return loaded
  }

  setSelectedPlantColor(color: string | null): number {
    const selectedPlantIds = getSelectedPlantIds(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
    const nextColor = normalizeHexColor(color)
    let changed = 0
    const before = this._captureCommandSnapshot()
    this._sceneStore.updatePersisted((persisted) => {
      persisted.plants = persisted.plants.map((plant) => {
        if (!selectedPlantIds.has(plant.id)) return plant
        const currentColor = normalizeHexColor(plant.color)
        if (currentColor === nextColor) return plant
        changed += 1
        return {
          ...plant,
          color: nextColor,
        }
      })
    })
    if (changed > 0) {
      this._markCanvasDirty(before)
      this._invalidate('scene')
    }
    return changed
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    const nextColor = normalizeHexColor(color)
    const previousSpeciesColor = normalizeHexColor(
      this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null,
    )
    const speciesColorChanged = previousSpeciesColor !== nextColor
    let changed = 0
    const before = this._captureCommandSnapshot()

    this._sceneStore.updatePersisted((persisted) => {
      persisted.plants = persisted.plants.map((plant) => {
        if (plant.canonicalName !== canonicalName) return plant
        const currentColor = normalizeHexColor(plant.color)
        if (currentColor === nextColor) return plant
        changed += 1
        return {
          ...plant,
          color: nextColor,
        }
      })
      const nextSpeciesColors = { ...persisted.plantSpeciesColors }
      if (nextColor) nextSpeciesColors[canonicalName] = nextColor
      else delete nextSpeciesColors[canonicalName]
      persisted.plantSpeciesColors = nextSpeciesColors
    })

    plantSpeciesColors.value = {
      ...this._sceneStore.persisted.plantSpeciesColors,
    }

    if (changed > 0 || speciesColorChanged) {
      this._markCanvasDirty(before)
      this._invalidate('scene')
    }

    return changed
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    const hadColor = normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null) !== null
    if (!hadColor) return false
    const before = this._captureCommandSnapshot()
    this._sceneStore.updatePersisted((persisted) => {
      const nextSpeciesColors = { ...persisted.plantSpeciesColors }
      delete nextSpeciesColors[canonicalName]
      persisted.plantSpeciesColors = nextSpeciesColors
    })
    plantSpeciesColors.value = {
      ...this._sceneStore.persisted.plantSpeciesColors,
    }
    this._markCanvasDirty(before)
    this._invalidate('scene')
    return true
  }

  loadDocument(file: CanopiFile): void {
    this._sceneStore.hydrate(file)
    this._history.clear()
    lockedObjectIds.value = new Set()
    clearCanvasSelection()
    this._syncCanvasSignalsFromScene()
    this._invalidate('scene')
    sceneEntityRevision.value += 1
  }

  replaceDocument(file: CanopiFile): void {
    this._resetTransientRuntimeState()
    this._sceneStore.hydrate(file)
    this._history.clear()
    this._syncCanvasSignalsFromScene()
    this._invalidate('scene')
    sceneEntityRevision.value += 1
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    // Check before updatePersisted — if neither signal nor persisted has guides,
    // skip guide sync so doc-provided guides in extra are preserved.
    const shouldSyncGuides = guides.value.length > 0 || Array.isArray(this._sceneStore.persisted.extra?.guides)
    this._sceneStore.updatePersisted((persisted) => {
      persisted.name = metadata.name
      persisted.description = metadata.description ?? doc.description ?? null
      persisted.location = metadata.location
        ? {
            lat: metadata.location.lat,
            lon: metadata.location.lon,
            altitudeM: metadata.location.altitude_m ?? null,
          }
        : hydrateLocationFromDoc(doc.location ?? null, persisted.location)
      persisted.northBearingDeg = metadata.northBearingDeg ?? doc.north_bearing_deg ?? persisted.northBearingDeg
      persisted.createdAt = doc.created_at ?? persisted.createdAt
      persisted.extra = { ...(doc.extra ?? persisted.extra ?? {}) }
    })
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: shouldSyncGuides })

    // Canvas-only output from scene store
    const canvasOutput = this._sceneStore.toCanopiFile({ now: new Date() })

    // Compose final document: canvas state + non-canvas sections from document store
    return {
      ...canvasOutput,
      description: metadata.description ?? doc.description ?? canvasOutput.description,
      consortiums: doc.consortiums,
      timeline: doc.timeline,
      budget: doc.budget,
      budget_currency: doc.budget_currency ?? 'EUR',
    }
  }

  markSaved(): void {
    this._history.markSaved()
  }

  clearHistory(): void {
    this._history.clear()
  }

  destroy(): void {
    this._interaction?.dispose()
    this._interaction = null
    this._chrome?.destroy()
    this._chrome = null
    for (const dispose of this._disposeEffects.splice(0)) dispose()
    void this._rendererHost.dispose()
  }

  resize(width: number, height: number): void {
    this._sceneStore.setViewport(this._camera.resize({ width, height }))
    void this._rendererHost.run((renderer) => {
      renderer.resize(width, height)
      renderer.setViewport(this._camera.viewport)
    })
    this._invalidate('chrome')
  }

  private _markCanvasDirty(before: SceneCommandSnapshot, type = 'scene-mutation'): void {
    const after = this._captureCommandSnapshot()
    const command = createScenePatchCommand(type, before, after)
    if (!command) return
    this._history.record(command)
    this._sceneStore.updateSession((session) => {
      session.documentRevision += 1
    })
    sceneEntityRevision.value += 1
  }

  private _invalidate(kind: RuntimeInvalidationKind = 'scene'): void {
    if (kind === 'chrome') {
      this._renderChrome()
      return
    }
    if (!this._container) return
    if (kind === 'viewport') {
      void this._renderViewportOnly()
      return
    }
    void this._render()
  }

  private _setSelection(ids: Iterable<string>): void {
    const nextIds = new Set(ids)
    this._sceneStore.setSelection(nextIds)
    setCanvasSelection(nextIds)
  }

  private _resetTransientRuntimeState(): void {
    resetTransientRuntimeState((name) => {
      this._interaction?.setTool(name)
    })
  }

  private _reorderSelected(position: 'start' | 'end'): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return

    const before = this._captureCommandSnapshot()
    const selectedPlantIds = new Set<string>()
    const selectedZoneIds = new Set<string>()
    const selectedAnnotationIds = new Set<string>()
    const selectedGroupIds = new Set<string>()

    for (const target of selected) {
      if (target.kind === 'plant') {
        selectedPlantIds.add(target.id)
        continue
      }
      if (target.kind === 'zone') {
        selectedZoneIds.add(target.id)
        continue
      }
      if (target.kind === 'annotation') {
        selectedAnnotationIds.add(target.id)
        continue
      }

      selectedGroupIds.add(target.id)
      const group = persisted.groups.find((entry) => entry.id === target.id)
      if (!group) continue
      for (const memberId of group.memberIds) {
        if (persisted.plants.some((plant) => plant.id === memberId)) selectedPlantIds.add(memberId)
        else if (persisted.zones.some((zone) => zone.name === memberId)) selectedZoneIds.add(memberId)
        else if (persisted.annotations.some((annotation) => annotation.id === memberId)) selectedAnnotationIds.add(memberId)
      }
    }

    this._sceneStore.updatePersisted((draft) => {
      draft.plants = reorderSceneEntities(draft.plants, selectedPlantIds, position, (plant) => plant.id)
      draft.zones = reorderSceneEntities(draft.zones, selectedZoneIds, position, (zone) => zone.name)
      draft.annotations = reorderSceneEntities(draft.annotations, selectedAnnotationIds, position, (annotation) => annotation.id)
      draft.groups = reorderSceneEntities(draft.groups, selectedGroupIds, position, (group) => group.id)
    })
    this._markCanvasDirty(before)
    this._invalidate('scene')
  }

  private _syncCanvasSignalsFromScene(): void {
    syncCanvasSignalsFromScene(this._sceneStore)
  }

  private _captureCommandSnapshot(): SceneCommandSnapshot {
    const snapshot = this._sceneStore.snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
      lockedIds: new Set(lockedObjectIds.value),
    }
  }

  private _historyRuntime() {
    return {
      sceneStore: this._sceneStore,
      setSelection: (ids: Iterable<string>) => {
        this._setSelection(ids)
      },
      setLockedIds: (ids: Iterable<string>) => {
        lockedObjectIds.value = new Set(ids)
      },
    }
  }

  private _installEffects(): void {
    this._disposeEffects.push(...installSceneRuntimeEffects({
      onTheme: () => {
        if (this._container) {
          refreshCanvasColorCache(this._container)
        }
        this._chrome?.refreshTheme()
        this._invalidate('scene')
      },
      onLocale: () => {
        this._invalidate('scene')
      },
      onChromeOverlay: () => {
        this._renderChrome()
      },
      onLayerSignals: () => {
        const changed = this._applySignalBackedSceneState({ recordHistory: true, syncGuides: true })
        if (changed) this._invalidate('scene')
      },
      onPanelTargetHover: () => {
        this._invalidate('scene')
      },
    }))
  }

  private async _render(): Promise<void> {
    if (!this._container) return
    const renderEpoch = ++this._renderEpoch
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
    await this._ensureSpeciesCacheForCurrentPresentation()
    if (renderEpoch !== this._renderEpoch) return
    const snapshot = this._buildRendererSnapshot()
    await this._rendererHost.run((renderer) => {
      renderer.resize(
        Math.max(1, this._container?.clientWidth ?? 1),
        Math.max(1, this._container?.clientHeight ?? 1),
      )
      renderer.renderScene(snapshot)
    }, {
      operationName: 'render scene',
    })
    this._renderChrome()
  }

  private async _renderViewportOnly(): Promise<void> {
    if (!this._container) return
    await this._rendererHost.run((renderer) => {
      renderer.setViewport(this._camera.viewport)
    }, {
      operationName: 'update viewport',
    })
    this._renderChrome()
  }

  private _renderChrome(): void {
    if (!this._chrome || !this._container) return
    this._chrome.update({
      viewport: this._camera.viewport,
      width: Math.max(1, this._container.clientWidth),
      height: Math.max(1, this._container.clientHeight),
      chromeVisible: this._chromeVisible,
      rulersVisible: rulersVisible.value,
      gridVisible: gridVisible.value,
      guides: guides.value,
    })
  }

  private _buildRendererSnapshot(): SceneRendererSnapshot {
    const scene = this._sceneStore.persisted
    const session = this._sceneStore.session
    const hoveredPlant = session.hoveredEntityId
      ? scene.plants.find((p) => p.id === session.hoveredEntityId)
      : null
    const highlightedSceneIds = new Set(resolvePanelTargets(hoveredPanelTargets.value, scene).sceneIds)
    return {
      scene,
      viewport: this._camera.viewport,
      selectedPlantIds: getSelectedPlantIds(scene, session.selectedEntityIds),
      selectedZoneIds: getSelectedZoneIds(scene, session.selectedEntityIds),
      selectedAnnotationIds: getSelectedAnnotationIds(scene, session.selectedEntityIds),
      highlightedPlantIds: getSelectedPlantIds(scene, highlightedSceneIds),
      highlightedZoneIds: getSelectedZoneIds(scene, highlightedSceneIds),
      sizeMode: session.plantSizeMode,
      colorByAttr: session.plantColorByAttr,
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames: this._plantLabels.getLocaleSnapshot(locale.value),
      hoveredCanonicalName: hoveredPlant?.canonicalName ?? null,
      selectionLabels: computeSelectionLabels(
        scene.plants,
        session.selectedEntityIds,
        this._camera.viewport,
        this._plantLabels.getLocaleSnapshot(locale.value),
      ),
    }
  }

  private _createPlantPresentationContext(viewportScale = this._camera.viewport.scale): PlantPresentationContext {
    const session = this._sceneStore.session
    return {
      viewport: {
        x: 0,
        y: 0,
        scale: viewportScale,
      },
      sizeMode: session.plantSizeMode,
      colorByAttr: session.plantColorByAttr,
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames: this._plantLabels.getLocaleSnapshot(locale.value),
    }
  }

  private async _ensureSpeciesCacheForCurrentPresentation(): Promise<void> {
    const session = this._sceneStore.session
    const plants = this._sceneStore.persisted.plants
    const canonicalNames = [...new Set(plants.map((plant) => plant.canonicalName))]
    if (canonicalNames.length === 0) return

    const labelsChanged = await this._plantLabels.ensureEntries(canonicalNames, locale.value)
    if (labelsChanged) plantNamesRevision.value += 1

    const needsSpeciesCache =
      session.plantColorByAttr !== null
      || session.plantSizeMode === 'canopy'
      || plants.some((plant) => plant.stratum === null || plant.canopySpreadM === null)
    if (!needsSpeciesCache) return
    await this._speciesCache.ensureEntries(canonicalNames, locale.value)
    this._backfillPlantPresentationMetadataFromSpeciesCache()
  }

  private _applySignalBackedSceneState(options: { recordHistory: boolean; syncGuides: boolean }): boolean {
    return applySignalBackedSceneState({
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._captureCommandSnapshot(),
      markDirty: (before, type) => this._markCanvasDirty(before, type),
    }, options)
  }

  private _addGuide(axis: 'h' | 'v', position: number): void {
    const before = this._captureCommandSnapshot()
    guides.value = [
      ...guides.value,
      { id: crypto.randomUUID(), axis, position },
    ]
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
    this._markCanvasDirty(before, 'guide-add')
    this._renderChrome()
  }

  private _backfillPlantPresentationMetadataFromSpeciesCache(): boolean {
    const speciesCache = this._speciesCache.getCache()
    let changed = false
    this._sceneStore.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) => {
        const nextStratum = resolvePlantStratum(plant, speciesCache)
        const nextCanopySpreadM = resolvePlantCanopySpreadM(plant, speciesCache)
        const nextScale = nextCanopySpreadM ?? plant.scale
        if (nextStratum === plant.stratum && nextCanopySpreadM === plant.canopySpreadM && nextScale === plant.scale) {
          return plant
        }
        changed = true
        return {
          ...plant,
          stratum: nextStratum,
          canopySpreadM: nextCanopySpreadM,
          scale: nextScale,
        }
      })
    })
    return changed
  }
}

function hydrateLocationFromDoc(
  location: CanopiFile['location'] | null,
  fallback: ScenePersistedState['location'],
) {
  if (!location) return fallback ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitudeM: location.altitude_m ?? null,
  }
}

function reorderSceneEntities<T>(
  items: T[],
  selectedIds: Set<string>,
  position: 'start' | 'end',
  getId: (item: T) => string,
): T[] {
  if (selectedIds.size === 0) return items
  const selected: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (selectedIds.has(getId(item))) selected.push(item)
    else rest.push(item)
  }
  return position === 'start'
    ? [...selected, ...rest]
    : [...rest, ...selected]
}

function getMemberBounds(
  memberId: string,
  persisted: ScenePersistedState,
  annotationViewportScale: number,
  plantContext: PlantPresentationContext,
): SceneBounds | null {
  const plant = persisted.plants.find((entry) => entry.id === memberId)
  if (plant) {
    const bounds = getPlantWorldBounds(plant, {
      ...plantContext,
      viewport: { x: 0, y: 0, scale: annotationViewportScale },
    })
    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    }
  }

  const zone = persisted.zones.find((entry) => entry.name === memberId)
  if (zone && zone.points.length > 0) {
    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      const center = zone.points[0]!
      const radii = zone.points[1]!
      return {
        minX: center.x - radii.x,
        minY: center.y - radii.y,
        maxX: center.x + radii.x,
        maxY: center.y + radii.y,
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of zone.points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    return { minX, minY, maxX, maxY }
  }

  const annotation = persisted.annotations.find((entry) => entry.id === memberId)
  if (!annotation) return null
  const bounds = getAnnotationWorldBounds(annotation, annotationViewportScale)
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  }
}
