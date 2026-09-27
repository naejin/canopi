import { describe, expect, it } from 'vitest'
import {
  addStory,
  addStoryStep,
  deleteStory,
  deleteStoryStep,
  duplicateStoryStep,
  moveStoryStep,
  moveStoryStepToStory,
  recaptureSavedView,
  renameStory,
  reorderStorySteps,
  restoreStory,
  restoreStoryStep,
  updateStoryStep,
  deleteSavedView,
} from '../app/design-edit'
import { savedViewPlantLabels } from '../app/design-edit/views'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { replaceCurrentDesignState } from './support/design-session-state'
import type { CanopiFile, SavedView, Story, StoryStep } from '../types/design'

function view(id: string): SavedView {
  return {
    id,
    name: `View ${id}`,
    camera: { lon: 2.2945, lat: 48.8584, zoom: 18, bearing: 0 },
    visible_layers: {
      background: { kind: 'basemap', style: 'liberty' },
      terrain: { contours: false, hillshade: false },
      scene_layers: ['plants'],
      site_data: [],
    },
    highlighted: { species: [], objects: [] },
    title: 'Title',
    text: [],
  }
}

function step(id: string, viewId = 'a'): StoryStep {
  return { id, view_id: viewId, title: `Step ${id}`, text: [], images: [] }
}

function story(id: string, steps: StoryStep[] = []): Story {
  return { id, name: `Story ${id}`, steps }
}

function open(stories: Story[] = [], views: SavedView[] = [view('a'), view('b')]): void {
  const file: CanopiFile = {
    version: 9, name: 'Stories', description: null, plant_species_colors: {},
    layers: [], plants: [], zones: [], annotations: [], consortiums: [], groups: [],
    timeline: [], budget: [], budget_currency: 'EUR', views, stories,
    created_at: '', updated_at: '', extra: {},
  }
  replaceCurrentDesignState(file, null, file.name)
  designSessionStore.resetDirtyBaselines()
}

const steps = (storyIndex = 0) => currentDesign.value!.stories![storyIndex]!.steps.map((entry) => entry.id)

describe('story Design Edit commands', () => {
  it('adds, renames and deletes stories as Design edits, and Undo restores a story where it was', () => {
    open([story('s1')])
    addStory(story('s2', [step('x')]))
    renameStory('s2', '  Client visit ')
    renameStory('s2', '   ')
    expect(currentDesign.value?.stories?.map((entry) => entry.name)).toEqual(['Story s1', 'Client visit'])
    expect(designSessionStore.designDirty.value).toBe(true)

    const deletion = deleteStory('s1')!
    expect(currentDesign.value?.stories?.map((entry) => entry.id)).toEqual(['s2'])
    restoreStory(deletion)
    expect(currentDesign.value?.stories?.map((entry) => entry.id)).toEqual(['s1', 's2'])
  })

  it('changes nothing for unknown ids or a repeated value', () => {
    open([story('s1', [step('x')])])
    const before = currentDesign.value
    renameStory('s1', 'Story s1')
    renameStory('missing', 'Name')
    updateStoryStep('s1', 'x', { title: 'Step x' })
    updateStoryStep('s1', 'missing', { title: 'New' })
    moveStoryStep('s1', 'x', 0)
    expect(deleteStory('missing')).toBeNull()
    expect(deleteStoryStep('s1', 'missing')).toBeNull()
    expect(currentDesign.value).toBe(before)
    expect(designSessionStore.designDirty.value).toBe(false)
  })

  it('adds steps only for views that exist, at the end or at an index', () => {
    open([story('s1', [step('x')])])
    addStoryStep('s1', step('y'))
    addStoryStep('s1', step('w'), 0)
    addStoryStep('s1', step('z', 'missing'))
    addStoryStep('s1', step('x'))
    expect(steps()).toEqual(['w', 'x', 'y'])
  })

  it('edits a step’s title, text, images and view, refusing a view that does not exist', () => {
    open([story('s1', [step('x')])])
    const text = [{ kind: 'paragraph' as const, spans: [{ text: 'Hi', bold: true, italic: false, link: null }] }]
    updateStoryStep('s1', 'x', { title: 'Hedges', text, images: [{ src: 'https://example.org/a.png', alt: 'Hedge' }], view_id: 'b' })
    expect(currentDesign.value?.stories?.[0]?.steps[0]).toEqual({
      id: 'x', view_id: 'b', title: 'Hedges', text, images: [{ src: 'https://example.org/a.png', alt: 'Hedge' }],
    })
    updateStoryStep('s1', 'x', { view_id: 'missing' })
    expect(currentDesign.value?.stories?.[0]?.steps[0]?.view_id).toBe('b')
  })

  it('moves, reorders and duplicates steps', () => {
    open([story('s1', [step('x'), step('y'), step('z')])])
    moveStoryStep('s1', 'x', 2)
    expect(steps()).toEqual(['y', 'z', 'x'])
    moveStoryStep('s1', 'x', -5)
    expect(steps()).toEqual(['x', 'y', 'z'])
    reorderStorySteps('s1', ['z', 'x', 'y'])
    expect(steps()).toEqual(['z', 'x', 'y'])
    reorderStorySteps('s1', ['z', 'x'])
    reorderStorySteps('s1', ['z', 'z', 'y'])
    expect(steps()).toEqual(['z', 'x', 'y'])
    duplicateStoryStep('s1', 'x', 'x2')
    expect(steps()).toEqual(['z', 'x', 'x2', 'y'])
    expect(currentDesign.value?.stories?.[0]?.steps[2]).toMatchObject({ view_id: 'a', title: 'Step x' })
  })

  it('moves a step to the end of another story, with a new id only when the id is taken there', () => {
    open([story('s1', [step('x'), step('y')]), story('s2', [step('x')])])
    moveStoryStepToStory('s1', 'y', 's2', 'new-y')
    moveStoryStepToStory('s1', 'x', 's2', 'new-x')
    expect(steps(0)).toEqual([])
    expect(steps(1)).toEqual(['x', 'y', 'new-x'])
  })

  it('deletes a step and Undo puts it back where it was, unless its view went away', () => {
    open([story('s1', [step('x'), step('y', 'b')])])
    const deletion = deleteStoryStep('s1', 'x')!
    expect(steps()).toEqual(['y'])
    restoreStoryStep(deletion)
    expect(steps()).toEqual(['x', 'y'])

    const deletedY = deleteStoryStep('s1', 'y')!
    deleteSavedView('b')
    restoreStoryStep(deletedY)
    expect(steps()).toEqual(['x'])
  })

  it('restores a deleted story without steps whose view went away', () => {
    open([story('s1', [step('x'), step('y', 'b')])])
    const deletion = deleteStory('s1')!
    deleteSavedView('b')
    restoreStory(deletion)
    expect(steps()).toEqual(['x'])
  })
})

describe('recapturing a saved view', () => {
  it('replaces what the view shows and keeps its name, title and text', () => {
    open()
    const capture: SavedView = {
      ...view('fresh'),
      name: 'ignored',
      camera: { lon: 3, lat: 45, zoom: 17, bearing: 0 },
      visible_layers: { ...view('a').visible_layers, background: { kind: 'satellite' } },
      highlighted: { species: ['Lycium barbarum'], objects: [] },
      extent: { west: 2.9, south: 44.9, east: 3.1, north: 45.1 },
    }
    recaptureSavedView('a', capture, { labels: 'codes' })
    expect(currentDesign.value?.views?.[0]).toEqual({
      ...view('a'),
      camera: capture.camera,
      visible_layers: capture.visible_layers,
      highlighted: capture.highlighted,
      extent: capture.extent,
    })
    expect(savedViewPlantLabels(currentDesign.value, 'a')).toBe('codes')

    const before = currentDesign.value
    recaptureSavedView('a', capture, { labels: 'codes' })
    recaptureSavedView('missing', capture)
    expect(currentDesign.value).toBe(before)

    recaptureSavedView('a', { ...capture, extent: undefined })
    expect(currentDesign.value?.views?.[0]).not.toHaveProperty('extent')
  })
})
