import { describe, expect, it } from 'vitest'
import {
  addSavedView,
  deleteSavedView,
  renameSavedView,
  restoreSavedView,
} from '../app/design-edit'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { replaceCurrentDesignState } from './support/design-session-state'
import type { CanopiFile, SavedView, Story, StoryStep } from '../types/design'

function design(): CanopiFile {
  return {
    version: 9,
    name: 'Views',
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
    views: [],
    stories: [],
    created_at: '',
    updated_at: '',
    extra: {},
  }
}

function view(id: string, zoom = 18): SavedView {
  return {
    id,
    name: `View ${id}`,
    camera: { lon: 2.2945, lat: 48.8584, zoom, bearing: 0 },
    visible_layers: {
      background: { kind: 'basemap', style: 'liberty' },
      terrain: { contours: false, hillshade: false },
      scene_layers: ['plants'],
      site_data: [],
    },
    highlighted: { species: [], objects: [] },
    title: null,
    text: [],
  }
}

function step(id: string, viewId: string): StoryStep {
  return { id, view_id: viewId, title: `Step ${id}`, text: [], images: [] }
}

function story(id: string, steps: StoryStep[] = []): Story {
  return { id, name: `Story ${id}`, steps }
}

function start(overrides: Partial<CanopiFile> = {}): void {
  replaceCurrentDesignState({ ...design(), ...overrides }, null, 'Views')
}

function views(): string[] {
  return (currentDesign.value?.views ?? []).map((entry) => entry.id)
}

function stepsOf(storyId: string): string[] {
  return currentDesign.value?.stories?.find((entry) => entry.id === storyId)?.steps.map((entry) => entry.id) ?? []
}

describe('saved views through Design Edit', () => {
  it('adds and renames views and dirties the Design', () => {
    start()
    expect(designSessionStore.designDirty.value).toBe(false)

    addSavedView(view('a'))
    addSavedView(view('b'))
    expect(views()).toEqual(['a', 'b'])
    expect(designSessionStore.designDirty.value).toBe(true)

    renameSavedView('b', '  Pond  ')
    expect(currentDesign.value?.views?.[1]?.name).toBe('Pond')
  })

  it('leaves the Design untouched when a command changes nothing', () => {
    start()
    addSavedView(view('a'))
    const before = currentDesign.value

    addSavedView(view('a', 3))
    renameSavedView('a', 'View a')
    renameSavedView('a', '   ')
    renameSavedView('missing', 'Pond')
    expect(deleteSavedView('missing')).toBeNull()

    expect(currentDesign.value).toBe(before)
  })

  it('deleting a view removes the story steps that show it and undo restores both in place', () => {
    start({
      views: [view('a'), view('b'), view('c')],
      stories: [
        story('s', [step('1', 'a'), step('2', 'b'), step('3', 'a')]),
        story('t', [step('4', 'c')]),
      ],
    })

    const deletion = deleteSavedView('a')

    expect(views()).toEqual(['b', 'c'])
    expect(stepsOf('s')).toEqual(['2'])
    expect(stepsOf('t')).toEqual(['4'])
    expect(deletion?.view.id).toBe('a')
    expect(deletion?.index).toBe(0)
    expect(deletion?.steps.map((entry) => [entry.storyId, entry.step.id, entry.index])).toEqual([
      ['s', '1', 0],
      ['s', '3', 2],
    ])

    addSavedView(view('d'))
    restoreSavedView(deletion!)

    expect(views()).toEqual(['a', 'b', 'c', 'd'])
    expect(stepsOf('s')).toEqual(['1', '2', '3'])
  })

  it('restoring twice or after the story went away keeps references whole', () => {
    start({ views: [view('a')], stories: [story('s', [step('1', 'a')])] })
    const deletion = deleteSavedView('a')!

    restoreSavedView(deletion)
    const restored = currentDesign.value
    restoreSavedView(deletion)
    expect(currentDesign.value).toBe(restored)

    deleteSavedView('a')
    start({ views: [], stories: [] })
    restoreSavedView(deletion)
    expect(views()).toEqual(['a'])
    expect(currentDesign.value?.stories).toEqual([])
  })
})
