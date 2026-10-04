import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDesignSessionReplacement } from '../document-session/replacement'
import { createDesignSessionStoreTestFixture, designSessionStore } from '../document-session/store'
import { setCurrentCanvasSession } from '../../canvas/session'
import { CURRENT_CANOPI_FILE_VERSION } from '../../generated/canopi-design-format'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import { geoAt } from '../../__tests__/support/geo-design'
import { createLiveTestCanvasRuntimeHost, type CanvasRuntimeHost } from '../../__tests__/support/live-canvas-runtime'
import { finishSiteLocate, searchSiteAgain, siteLocateOpen } from './state'

let host: CanvasRuntimeHost

beforeEach(() => {
  host = createLiveTestCanvasRuntimeHost()
  setCurrentCanvasSession(host.surfaces)
})

afterEach(async () => {
  setCurrentCanvasSession(null)
  await host.destroy()
  createDesignSessionStoreTestFixture(designSessionStore).reset()
})

/** Opens a Draft (no file path) the way both editions replace the open Design. */
function open(file: CanopiFile, kind: 'new' | 'loaded'): void {
  createDesignSessionReplacement({ store: designSessionStore, workflowRunner: { install() {}, dispose() {} } })
    .replace({ file, kind, path: null, name: file.name }, host.surfaces.documents, () => true)
}

function deleteEverything(): void {
  host.surfaces.commands.sceneEdits.selectAll()
  host.surfaces.commands.sceneEdits.deleteSelected()
  expect(host.surfaces.queries.getScenePhysicalExtentMeters()).toBeNull()
}

function placePlant(): void {
  host.surfaces.commands.sceneEdits.importDesignObjects({
    plants: [plant('first', 0, 0)], zones: [], annotations: [], measurementGuides: [], groups: [],
  })
  expect(host.surfaces.queries.getScenePhysicalExtentMeters()).not.toBeNull()
}

describe('Where is your site?', () => {
  it('a new Design opens the prompt', () => {
    open(design('Untitled'), 'new')
    expect(siteLocateOpen.value).toBe(true)
  })

  it('the prompt stays closed when a located Design becomes empty', () => {
    open(design('Orchard', [plant('apple', 0, 0), plant('pear', 6, 0)]), 'loaded')
    expect(siteLocateOpen.value).toBe(false)

    deleteEverything()

    expect(siteLocateOpen.value).toBe(false)
  })

  it('the first object closes the prompt for the rest of the session', () => {
    open(design('Untitled'), 'new')
    placePlant()
    expect(siteLocateOpen.value).toBe(false)

    host.surfaces.commands.history.undo()

    expect(host.surfaces.queries.getScenePhysicalExtentMeters()).toBeNull()
    expect(siteLocateOpen.value).toBe(false)
  })

  it('Skip closes the prompt, and emptying the Design later keeps it closed', () => {
    open(design('Untitled'), 'new')
    finishSiteLocate(null)
    expect(siteLocateOpen.value).toBe(false)

    placePlant()
    deleteEverything()

    expect(siteLocateOpen.value).toBe(false)
  })

  it('Search again reopens the prompt over a Design with objects until the site is chosen', () => {
    open(design('Untitled'), 'new')
    finishSiteLocate(null)
    placePlant()

    searchSiteAgain()
    expect(siteLocateOpen.value).toBe(true)

    finishSiteLocate('Ballon-Saint-Mars')
    expect(siteLocateOpen.value).toBe(false)
    deleteEverything()
    expect(siteLocateOpen.value).toBe(false)
  })

  it('a new Design session asks again after an emptied one', () => {
    open(design('Orchard', [plant('apple', 0, 0)]), 'loaded')
    deleteEverything()
    expect(siteLocateOpen.value).toBe(false)

    open(design('Untitled'), 'new')

    expect(siteLocateOpen.value).toBe(true)
  })

  it('a Design opened with no objects asks where its site is', () => {
    open(design('Orchard', [plant('apple', 0, 0)]), 'loaded')
    open(design('Empty Draft'), 'loaded')
    expect(siteLocateOpen.value).toBe(true)
  })
})

function design(name: string, plants: PlacedPlant[] = []): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name,
    description: null,
    plant_species_colors: {},
    layers: [],
    plants,
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-09-29T00:00:00.000Z',
  }
}

function plant(id: string, x: number, y: number): PlacedPlant {
  return {
    id, locked: false, canonical_name: 'Malus domestica', common_name: 'Apple', color: null,
    position: geoAt(x, y), rotation: null, scale: null, notes: null, planted_date: null, quantity: 1,
  }
}
