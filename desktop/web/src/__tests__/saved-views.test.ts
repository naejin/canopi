import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canShowSavedViews,
  cancelDeleteView,
  closeManageViewsDialog,
  closeSaveViewDialog,
  confirmDeleteView,
  confirmSaveViewDialog,
  dismissDeleteViewUndo,
  goToSavedView,
  manageViewsDialogOpen,
  openManageViewsDialog,
  openSaveViewDialog,
  renameView,
  requestDeleteView,
  saveCurrentView,
  savedViewDeleteConfirmation,
  savedViewDialogOpen,
  savedViewUndo,
  saveViewDialog,
  undoDeleteView,
} from '../app/saved-views'
import { composeSavedView } from '../app/saved-views/model'
import { describeSavedViewSnapshot, VIEW_SNAPSHOT_THUMBNAIL } from '../app/saved-views/snapshot'
import type { ViewCamera } from '../canvas/runtime/view/types'
import { savedViewPlantLabels } from '../app/design-edit/views'
import { setPlantLabels } from '../app/plant-display/actions'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { mapZoomToStageScale } from '../canvas/projection'
import { createSessionPlane } from '../canvas/session-plane'
import { setCurrentCanvasSession } from '../canvas/session'
import type { CanopiFile, PlacedPlant, SavedView, Story } from '../types/design'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { replaceCurrentDesignState } from './support/design-session-state'
import { TEST_GEO_ORIGIN } from './support/geo-design'

function design(views: SavedView[] = [], stories: Story[] = []): CanopiFile {
  return {
    version: 9,
    name: 'Orchard',
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    lidar: {
      schema_version: 1,
      entries: [
        { kind: 'Source', id: 'dtm-shown', visible: true, opacity: 1, order: 0, style: null },
        { kind: 'Source', id: 'dtm-hidden', visible: false, opacity: 1, order: 1, style: null },
      ],
    },
    views,
    stories,
    created_at: '',
    updated_at: '',
    extra: {},
  }
}

const BERRIES: SavedView = {
  id: 'berries',
  name: 'Berry hedges',
  camera: { lon: 13.0012, lat: 22.9991, zoom: 19.5, bearing: 0 },
  visible_layers: {
    background: { kind: 'satellite' },
    terrain: { contours: false, hillshade: true },
    scene_layers: ['plants'],
    site_data: [],
  },
  highlighted: {
    species: ['Rubus idaeus', 'Lycium barbarum'],
    objects: [{ kind: 'plant', id: 'p1' }, { kind: 'measurement_guide', id: 'g1' }],
  },
  title: null,
  text: [],
}

function plant(canonicalName: string): PlacedPlant {
  return {
    id: canonicalName, canonical_name: canonicalName, common_name: null, color: null,
    position: TEST_GEO_ORIGIN, rotation: null, scale: null, notes: null,
    planted_date: null, quantity: 1, locked: false,
  }
}

const POND: SavedView = { ...BERRIES, id: 'pond', name: 'Pond' }

function visit(viewIds: string[]): Story {
  return {
    id: 'visit',
    name: 'Client visit',
    steps: viewIds.map((viewId, index) => ({ id: `step-${index}`, view_id: viewId, title: 'Step', text: [], images: [] })),
  }
}

function mountCanvas() {
  const scale = mapZoomToStageScale(18, TEST_GEO_ORIGIN.lat)
  const scene = createDefaultScenePersistedState()
  scene.layers = [
    { kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 1 },
    { kind: 'layer', name: 'water', visible: false, locked: false, opacity: 1 },
  ]
  const queries = createTestCanvasQuerySurface({
    scene,
    // The plane origin sits at the screen centre (400 × 300 test screen).
    placement: { x: 200, y: 150, scale },
    plants: [plant('Lycium barbarum')],
    selection: [{ kind: 'zone', id: 'Hedge' }, { kind: 'measurement-guide', id: 'g1' }],
    sessionPlane: createSessionPlane(TEST_GEO_ORIGIN),
  })
  queries.getSpeciesFocus = () => ({ canonicalName: 'Lycium barbarum', showCodes: false })
  const showPlace = vi.fn(() => true)
  const showCamera = vi.fn<(camera: ViewCamera, options?: { readonly motion?: 'fly' | 'jump' }) => void>()
  const focus = vi.fn()
  const selectSpecies = vi.fn()
  const commands = createTestCanvasCommandSurface()
  commands.viewport.showPlace = showPlace
  commands.viewport.showCamera = showCamera
  commands.speciesFocus.focus = focus
  commands.sceneEdits.selectSpecies = selectSpecies
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ commands, queries }))
  return { showPlace, showCamera, focus, selectSpecies, queries }
}

/** The camera going to BERRIES shows: its centre, zoom and bearing. */
function berriesCamera(bearingDeg = 0): ViewCamera {
  return { center: { lon: 13.0012, lat: 22.9991 }, zoom: 19.5, bearingDeg, pitchDeg: 0 }
}

afterEach(() => {
  setCurrentCanvasSession(null)
  closeSaveViewDialog()
  closeManageViewsDialog()
  dismissDeleteViewUndo()
  mapLayers.value = createDefaultMapLayers()
})

describe('saving the current view', () => {
  it('saves the camera, layers, focused species, selection and title as Design Edit data', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    mountCanvas()
    mapLayers.value = { ...createDefaultMapLayers(), hillshade: { visible: true, opacity: 0.5 } }
    expect(designSessionStore.designDirty.value).toBe(false)

    const saved = saveCurrentView({ name: '  Hedges  ', title: '  The berry hedges ' })

    expect(saved).not.toBeNull()
    expect(currentDesign.value?.views).toEqual([saved])
    expect(saved).toMatchObject({
      name: 'Hedges',
      title: 'The berry hedges',
      camera: { lon: TEST_GEO_ORIGIN.lon, lat: TEST_GEO_ORIGIN.lat, bearing: 0 },
      visible_layers: {
        background: { kind: 'basemap', style: 'liberty' },
        terrain: { contours: false, hillshade: true },
        scene_layers: ['plants'],
        site_data: ['dtm-shown'],
      },
      highlighted: {
        species: ['Lycium barbarum'],
        objects: [{ kind: 'zone', id: 'Hedge' }, { kind: 'measurement_guide', id: 'g1' }],
      },
      text: [],
    })
    expect(saved!.camera.zoom).toBeCloseTo(18, 6)
    expect(designSessionStore.designDirty.value).toBe(true)
  })

  it('a thumbnail scales the camera zoom by the screen ratio', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    const { queries } = mountCanvas()
    // The view still records the ground the map shows (the test screen is 400 × 300 at zoom 18) ...
    const saved = saveCurrentView({ name: 'Hedges' })!
    expect(saved.extent).toBeDefined()
    expect(saved.extent!.west).toBeLessThan(TEST_GEO_ORIGIN.lon)
    expect(saved.extent!.north).toBeGreaterThan(TEST_GEO_ORIGIN.lat)
    // ... but its thumbnail frames what going to it shows: the camera zoom, scaled from the 400 × 300 workspace to the
    // 320 × 200 image (limited by the height), at the view's bearing, whatever extent was recorded.
    const turned: SavedView = { ...BERRIES, camera: { ...BERRIES.camera, bearing: 30 }, extent: { west: 13, south: 22.99, east: 13.01, north: 23 } }
    const request = describeSavedViewSnapshot(turned, VIEW_SNAPSHOT_THUMBNAIL, {
      queries, mapLayers: createDefaultMapLayers(), locale: 'en', plantLabels: 'names',
    })!
    expect(request.camera.lon).toBe(13.0012)
    expect(request.camera.lat).toBe(22.9991)
    expect(request.camera.zoom).toBeCloseTo(19.5 + Math.log2(200 / 300), 9)
    expect(request.camera.bearing).toBe(30)
  })

  it('records the label choice with the view, and presents the view with it', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    mountCanvas()
    setPlantLabels('codes')

    const saved = saveCurrentView({ name: 'Hedges' })!

    expect(savedViewPlantLabels(currentDesign.value, saved.id)).toBe('codes')
    // The file format keeps views as they are; the choice is Design extra data.
    expect(currentDesign.value?.extra?.saved_view_display).toEqual({ [saved.id]: { labels: 'codes' } })
    expect(Object.keys(saved)).not.toContain('labels')
    setPlantLabels('none')
    expect(savedViewPlantLabels(currentDesign.value, saved.id)).toBe('codes')
    // A view saved before labels were recorded shows the Design's current choice.
    expect(savedViewPlantLabels(currentDesign.value, 'unknown')).toBeNull()
  })

  it('stores a blank title as none', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    mountCanvas()
    expect(saveCurrentView({ name: 'Pond', title: '   ' })?.title).toBeNull()
    expect(saveCurrentView({ name: 'Pond again' })?.title).toBeNull()
  })

  it('cannot save without an open Design on a map', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    expect(canShowSavedViews()).toBe(false)
    expect(saveCurrentView({ name: 'View' })).toBeNull()
    openSaveViewDialog()
    expect(saveViewDialog.value).toBeNull()
  })

  it('names a new view through the dialog, which stays open for a blank name', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    mountCanvas()

    openSaveViewDialog()
    expect(saveViewDialog.value).toEqual({ defaultName: 'View 2' })
    expect(savedViewDialogOpen.value).toBe(true)
    expect(confirmSaveViewDialog({ name: '   ', title: '' })).toBe(false)
    expect(saveViewDialog.value).not.toBeNull()
    expect(confirmSaveViewDialog({ name: 'Pond', title: 'From the south' })).toBe(true)

    expect(saveViewDialog.value).toBeNull()
    expect(currentDesign.value?.views?.map((view) => [view.name, view.title])).toEqual([
      ['Berry hedges', null],
      ['Pond', 'From the south'],
    ])
  })

  it('drops the dialog when another Design replaces the one that opened it', () => {
    replaceCurrentDesignState(design(), null, 'Orchard')
    mountCanvas()
    openSaveViewDialog()

    replaceCurrentDesignState(design(), null, 'Other')

    expect(saveViewDialog.value).toBeNull()
    expect(confirmSaveViewDialog({ name: 'Late', title: '' })).toBe(false)
    expect(currentDesign.value?.views).toEqual([])
  })
})

describe('going to a saved view', () => {
  it('flies the camera there and touches nothing else: no Design edit, dirt, layers, focus or selection', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    const { showPlace, showCamera, focus, selectSpecies } = mountCanvas()
    designSessionStore.resetDirtyBaselines()
    expect(designSessionStore.designDirty.value).toBe(false)
    const before = currentDesign.value
    const revision = designSessionStore.committedDesignRevision.value
    const layersBefore = mapLayers.value

    expect(goToSavedView('berries')).toBe(true)

    expect(showCamera).toHaveBeenCalledWith(berriesCamera(), { motion: 'fly' })
    expect(showPlace).not.toHaveBeenCalled()
    expect(currentDesign.value).toBe(before)
    expect(designSessionStore.designDirty.value).toBe(false)
    expect(designSessionStore.committedDesignRevision.value).toBe(revision)
    expect(mapLayers.value).toBe(layersBefore)
    expect(focus).not.toHaveBeenCalled()
    expect(selectSpecies).not.toHaveBeenCalled()
  })

  it('ignores unknown views', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    const { showCamera } = mountCanvas()

    expect(goToSavedView('missing')).toBe(false)
    expect(goToSavedView('berries')).toBe(true)

    expect(showCamera).toHaveBeenCalledTimes(1)
    expect(showCamera).toHaveBeenCalledWith(berriesCamera(), { motion: 'fly' })
  })

  it('going to a view restores its camera zoom in any window size', () => {
    // Saved on a screen twice the size of the 400 × 300 test screen, turned 30°: the recorded ground is not fitted to this
    // window; the camera's centre, zoom and bearing are restored as saved.
    const extent = { west: 13.0002, south: 22.9985, east: 13.0022, north: 22.9997 }
    replaceCurrentDesignState(design([{ ...BERRIES, camera: { ...BERRIES.camera, bearing: 30 }, extent }]), null, 'Orchard')
    const { showCamera } = mountCanvas()

    goToSavedView('berries')

    expect(showCamera).toHaveBeenCalledWith(berriesCamera(30), { motion: 'fly' })
  })

  it('does nothing without a map', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    expect(goToSavedView('berries')).toBe(false)
  })
})

describe('managing views', () => {
  it('renames a view; a blank name keeps the old one', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    renameView('berries', '  Hedges ')
    renameView('berries', '  ')
    expect(currentDesign.value?.views?.[0]?.name).toBe('Hedges')
  })

  it('deletes an unused view at once and offers Undo', () => {
    replaceCurrentDesignState(design([BERRIES, POND]), null, 'Orchard')
    openManageViewsDialog()
    expect(manageViewsDialogOpen.value).toBe(true)

    requestDeleteView('berries')

    expect(savedViewDeleteConfirmation.value).toBeNull()
    expect(currentDesign.value?.views?.map((view) => view.id)).toEqual(['pond'])
    expect(savedViewUndo.value?.message).toBe('Deleted “Berry hedges”')

    undoDeleteView()
    expect(currentDesign.value?.views?.map((view) => view.id)).toEqual(['berries', 'pond'])
    expect(savedViewUndo.value).toBeNull()
  })

  it('forgets a deleted view’s label choice and brings it back with Undo', () => {
    replaceCurrentDesignState(
      { ...design([BERRIES, POND]), extra: { saved_view_display: { berries: { labels: 'none' }, pond: { labels: 'codes' } } } },
      null,
      'Orchard',
    )
    requestDeleteView('berries')
    expect(currentDesign.value?.extra?.saved_view_display).toEqual({ pond: { labels: 'codes' } })
    undoDeleteView()
    expect(savedViewPlantLabels(currentDesign.value, 'berries')).toBe('none')

    requestDeleteView('pond')
    requestDeleteView('berries')
    expect(currentDesign.value?.extra).not.toHaveProperty('saved_view_display')
  })

  it('asks first, naming the stories, when stories show the view', () => {
    replaceCurrentDesignState(
      design([BERRIES, POND], [visit(['berries', 'pond']), { ...visit(['berries']), id: 'tour', name: 'Open day' }]),
      null,
      'Orchard',
    )
    const before = currentDesign.value

    requestDeleteView('berries')
    expect(savedViewDeleteConfirmation.value).toEqual({
      viewId: 'berries',
      viewName: 'Berry hedges',
      stories: ['Client visit', 'Open day'],
    })
    expect(currentDesign.value).toBe(before)

    cancelDeleteView()
    expect(savedViewDeleteConfirmation.value).toBeNull()
    expect(currentDesign.value).toBe(before)

    requestDeleteView('berries')
    confirmDeleteView()
    expect(currentDesign.value?.views?.map((view) => view.id)).toEqual(['pond'])
    expect(currentDesign.value?.stories?.map((story) => story.steps.map((step) => step.view_id))).toEqual([['pond'], []])

    undoDeleteView()
    expect(currentDesign.value?.stories?.map((story) => story.steps.map((step) => step.view_id))).toEqual([
      ['berries', 'pond'],
      ['berries'],
    ])
  })

  it('never undoes into another Design', () => {
    replaceCurrentDesignState(design([BERRIES]), null, 'Orchard')
    requestDeleteView('berries')
    expect(savedViewUndo.value).not.toBeNull()

    replaceCurrentDesignState(design(), null, 'Other')
    expect(savedViewUndo.value).toBeNull()
    undoDeleteView()
    expect(currentDesign.value?.views).toEqual([])
  })
})

describe('saved view model', () => {
  it('rounds the camera like stored positions and clamps zoom to the map range', () => {
    const view = composeSavedView({
      id: 'v', name: 'V', title: null,
      view: { lon: 2.29448123456789, lat: 48.85837012345678, zoom: 31, bearing: 0 },
      mapLayers: createDefaultMapLayers(),
      sceneLayers: [], siteData: [], focusedSpecies: null, selection: [],
    })
    expect(view.camera).toEqual({ lon: 2.294481235, lat: 48.858370123, zoom: 27, bearing: 0 })
    expect(view.highlighted).toEqual({ species: [], objects: [] })
  })

  it('capture writes the bearing, rounded, 360 as 0', () => {
    const bearingOf = (bearing: number) => composeSavedView({
      id: 'v', name: 'V', title: null,
      view: { lon: 2.2944, lat: 48.8583, zoom: 18, bearing },
      mapLayers: createDefaultMapLayers(),
      sceneLayers: [], siteData: [], focusedSpecies: null, selection: [],
    }).camera.bearing
    expect(bearingOf(30)).toBe(30)
    expect(bearingOf(30.12345678912)).toBe(30.123457)
    expect(bearingOf(359.99999999)).toBe(0)
    expect(bearingOf(360)).toBe(0)
    expect(bearingOf(-15)).toBe(345)
  })
})
