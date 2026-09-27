import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import {
  goToPresentedStep,
  leaveStoryPresentation,
  nextPresentedStep,
  presentedMapLayers,
  presentedStep,
  presentStory,
  previousPresentedStep,
  storyPresentationActive,
  storyPresentationOverrides,
} from '../app/story-presentation'
import { StoryPresenter } from '../components/stories/StoryPresenter'
import { PanelRail } from '../components/shared/PanelRail'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { modalLayerOpen } from '../app/shell/modal-layer'
import { readPanelTargetOverlaySnapshot } from '../app/panel-targets/presentation'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import { mapZoomToStageScale } from '../canvas/projection'
import { createSessionPlane } from '../canvas/session-plane'
import { setCurrentCanvasSession } from '../canvas/session'
import type { PlantDisplay } from '../canvas/runtime/plant-display'
import { locale } from '../app/settings/state'
import type { CanopiFile, SavedView, Story } from '../types/design'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { replaceCurrentDesignState } from './support/design-session-state'
import { TEST_GEO_ORIGIN } from './support/geo-design'

function view(id: string, overrides: Partial<SavedView['visible_layers']> = {}, species: string[] = []): SavedView {
  return {
    id,
    name: `View ${id}`,
    camera: { lon: TEST_GEO_ORIGIN.lon + 0.001, lat: TEST_GEO_ORIGIN.lat, zoom: 20, bearing: 0 },
    visible_layers: {
      background: { kind: 'satellite' },
      terrain: { contours: true, hillshade: false },
      scene_layers: ['plants'],
      site_data: ['dtm'],
      ...overrides,
    },
    highlighted: { species, objects: [{ kind: 'zone', id: 'zone-1' }, { kind: 'annotation', id: 'a1' }] },
    title: null,
    text: [],
  }
}

const TOUR: Story = {
  id: 'tour',
  name: 'Client visit',
  steps: [
    { id: 's1', view_id: 'site', title: 'The site', text: [{ kind: 'paragraph', spans: [{ text: 'Where water moves', bold: false, italic: false, link: null }] }], images: [] },
    { id: 's2', view_id: 'hedges', title: 'Berry hedges', text: [], images: [{ src: 'https://example.org/hedge.jpg', alt: 'The hedge in June' }] },
    { id: 's3', view_id: 'site', title: '', text: [], images: [] },
  ],
}

function design(): CanopiFile {
  return {
    version: 9, name: 'Stories', description: null, plant_species_colors: {},
    layers: [], plants: [], zones: [], annotations: [], consortiums: [], groups: [],
    timeline: [], budget: [], budget_currency: 'EUR',
    views: [
      view('site'),
      view('hedges', { background: { kind: 'basemap', style: 'dark' }, terrain: { contours: false, hillshade: true }, scene_layers: ['zones'], site_data: [] }, ['Lycium barbarum']),
    ],
    stories: [TOUR],
    created_at: '', updated_at: '',
    extra: { saved_view_display: { hedges: { labels: 'codes' } } },
  }
}

let commands: ReturnType<typeof createTestCanvasCommandSurface>
let presentLayers: ReturnType<typeof vi.fn<(names: readonly string[] | null) => void>>
let focus: ReturnType<typeof vi.fn<(name: string | null) => void>>
let showPlace: ReturnType<typeof vi.fn<(place: { readonly lon: number; readonly lat: number }, zoom: number, options?: { readonly motion?: 'fly' | 'jump' }) => boolean>>
let container: HTMLDivElement

function mountMap(): void {
  const queries = createTestCanvasQuerySurface({
    viewport: { x: 200, y: 150, scale: mapZoomToStageScale(18, TEST_GEO_ORIGIN.lat) },
    sessionPlane: createSessionPlane(TEST_GEO_ORIGIN),
  })
  queries.getSpeciesFocus = () => ({ canonicalName: 'Malus domestica' })
  queries.getLocalizedCommonNames = () => new Map([['Lycium barbarum', 'Goji']])
  commands = createTestCanvasCommandSurface()
  presentLayers = vi.fn()
  focus = vi.fn()
  showPlace = vi.fn(() => true)
  commands.layers.presentLayers = presentLayers
  commands.speciesFocus.focus = focus
  commands.viewport.showPlace = showPlace
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ commands, queries }))
}

beforeEach(() => {
  locale.value = 'en'
  replaceCurrentDesignState(design(), null, 'Stories')
  designSessionStore.resetDirtyBaselines()
  mountMap()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  leaveStoryPresentation()
  render(null, container)
  document.body.replaceChildren()
  setCurrentCanvasSession(null)
  mapLayers.value = createDefaultMapLayers()
})

describe('presenting a story', () => {
  it('applies a step’s view as session overrides and never touches the Design', () => {
    const before = currentDesign.value
    const revision = designSessionStore.committedDesignRevision.value
    const userLayers = mapLayers.value

    expect(presentStory('tour', 1, { reducedMotion: true })).toBe(true)

    expect(storyPresentationActive.value).toBe(true)
    expect(presentedStep.value?.step.id).toBe('s2')
    const presented = presentedMapLayers()
    expect(presented.basemap).toMatchObject({ visible: true, style: 'dark' })
    expect(presented.satellite.visible).toBe(false)
    expect(presented.contours.visible).toBe(false)
    expect(presented.hillshade.visible).toBe(true)
    expect(storyPresentationOverrides.value?.plantLabels).toBe('codes')
    expect([...storyPresentationOverrides.value!.siteDataIds]).toEqual([])
    expect(readPanelTargetOverlaySnapshot().selectedTargets).toEqual([
      { kind: 'species', canonical_name: 'Lycium barbarum' },
      { kind: 'zone', zone_id: 'zone-1' },
    ])
    expect(presentLayers).toHaveBeenLastCalledWith(['zones'])
    expect(focus).toHaveBeenLastCalledWith('Lycium barbarum')
    expect(showPlace).toHaveBeenLastCalledWith({ lon: TEST_GEO_ORIGIN.lon + 0.001, lat: TEST_GEO_ORIGIN.lat }, 20, { motion: 'jump' })
    expect(document.documentElement.hasAttribute('data-story-presenting')).toBe(true)

    expect(mapLayers.value).toBe(userLayers)
    expect(currentDesign.value).toBe(before)
    expect(designSessionStore.designDirty.value).toBe(false)
    expect(designSessionStore.committedDesignRevision.value).toBe(revision)
  })

  it('flies between steps unless reduced motion asks for a jump', () => {
    presentStory('tour', 0, { reducedMotion: false })
    expect(showPlace).toHaveBeenLastCalledWith(expect.anything(), 20, { motion: 'fly' })
  })

  it('moves between steps within the story', () => {
    presentStory('tour', 0, { reducedMotion: true })
    previousPresentedStep()
    expect(presentedStep.value?.index).toBe(0)
    nextPresentedStep()
    nextPresentedStep()
    expect(presentedStep.value?.index).toBe(2)
    nextPresentedStep()
    expect(presentedStep.value?.index).toBe(2)
    goToPresentedStep(1)
    expect(presentedStep.value?.step.id).toBe('s2')
    goToPresentedStep(7)
    expect(presentedStep.value?.step.id).toBe('s2')
  })

  it('restores the user’s state exactly on leaving: layers, site data, labels, focus, camera', () => {
    presentStory('tour', 1, { reducedMotion: true })
    showPlace.mockClear()

    leaveStoryPresentation()

    expect(storyPresentationActive.value).toBe(false)
    expect(storyPresentationOverrides.value).toBeNull()
    expect(presentedMapLayers()).toBe(mapLayers.value)
    expect(presentLayers).toHaveBeenLastCalledWith(null)
    expect(focus).toHaveBeenLastCalledWith('Malus domestica')
    expect(showPlace).toHaveBeenCalledTimes(1)
    expect(showPlace.mock.calls[0]![1]).toBeCloseTo(18, 6)
    expect(showPlace.mock.calls[0]![2]).toEqual({ motion: 'jump' })
    expect(document.documentElement.hasAttribute('data-story-presenting')).toBe(false)
    expect(designSessionStore.designDirty.value).toBe(false)
  })

  it('ends without moving the camera when another Design replaces this one', async () => {
    presentStory('tour', 0, { reducedMotion: true })
    showPlace.mockClear()

    replaceCurrentDesignState(design(), null, 'Other')
    await Promise.resolve()

    expect(storyPresentationActive.value).toBe(false)
    expect(presentLayers).toHaveBeenLastCalledWith(null)
    expect(showPlace).not.toHaveBeenCalled()
    expect(storyPresentationOverrides.value).toBeNull()
  })

  it('ends when its story goes away, and cannot present a story without steps or a map', async () => {
    presentStory('tour', 0, { reducedMotion: true })
    replaceCurrentDesignState({ ...design(), stories: [] }, null, 'Stories')
    await Promise.resolve()
    expect(storyPresentationActive.value).toBe(false)

    replaceCurrentDesignState({ ...design(), stories: [{ id: 'empty', name: 'Empty', steps: [] }] }, null, 'Stories')
    expect(presentStory('empty')).toBe(false)
    setCurrentCanvasSession(null)
    replaceCurrentDesignState(design(), null, 'Stories')
    expect(presentStory('tour')).toBe(false)
  })

  it('shows the step’s labels to the map and hides the grid and rulers, then gives them back', () => {
    const adapter = createAppCanvasRuntimeAppAdapter({ presentationData: {} as never })
    const displays: PlantDisplay[] = []
    const dispose = adapter.plantDisplay!.subscribe((display) => { displays.push(display) })
    const overlay = () => adapter.settings.readChromeOverlay()
    const before = overlay()

    presentStory('tour', 1, { reducedMotion: true })
    expect(displays.at(-1)?.labels).toBe('codes')
    expect(overlay()).toEqual({ gridVisible: false, rulersVisible: false })

    leaveStoryPresentation()
    expect(displays.at(-1)?.labels).toBe('names')
    expect(overlay()).toEqual(before)
    dispose()
  })
})

describe('the presenter', () => {
  async function present(index = 0): Promise<HTMLElement> {
    await act(async () => {
      presentStory('tour', index, { reducedMotion: true })
      render(<StoryPresenter />, container)
    })
    return container.querySelector<HTMLElement>('[data-story-presenter]')!
  }

  function key(target: Element, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('is a modal card with the story, the step and its text, and starts on Next', async () => {
    const presenter = await present(1)
    expect(presenter.getAttribute('role')).toBe('dialog')
    expect(presenter.getAttribute('aria-label')).toBe('Presenting Client visit')
    expect(modalLayerOpen.value).toBe(true)
    expect(presenter.querySelector('h1')?.textContent).toBe('Berry hedges')
    expect(presenter.textContent).toContain('Client visit · Step 2 of 3')
    expect(presenter.querySelector('img')?.getAttribute('alt')).toBe('The hedge in June')
    expect(presenter.textContent).toContain('Goji · 0 plants')
    expect(document.activeElement?.textContent).toContain('Next')
    expect(presenter.querySelector('[role="status"]')?.textContent).toBe('Step 2 of 3: Berry hedges')
    const dots = [...presenter.querySelectorAll<HTMLButtonElement>('nav button[aria-label^="Step"]')]
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual(['Step 1: The site', 'Step 2: Berry hedges', 'Step 3: Untitled step'])
    expect(dots[1]!.getAttribute('aria-current')).toBe('step')
  })

  it('moves with the arrow keys, Space away from buttons, the dots and Previous/Next, and leaves with Esc', async () => {
    const presenter = await present(0)
    await act(async () => { key(presenter, 'ArrowRight') })
    expect(presentedStep.value?.index).toBe(1)
    await act(async () => { key(presenter, 'ArrowLeft') })
    expect(presentedStep.value?.index).toBe(0)
    await act(async () => { key(presenter.querySelector('h1')!, ' ') })
    expect(presentedStep.value?.index).toBe(1)
    // Space on a focused button presses it instead.
    const spaceOnButton = key(presenter.querySelector('button')!, ' ')
    expect(spaceOnButton.defaultPrevented).toBe(false)
    await act(async () => { presenter.querySelector<HTMLButtonElement>('nav button[aria-label="Step 3: Untitled step"]')!.click() })
    expect(presentedStep.value?.index).toBe(2)
    expect(presenter.querySelector('[role="status"]')?.textContent).toBe('Step 3 of 3: Untitled step')
    const next = [...presenter.querySelectorAll<HTMLButtonElement>('nav button')].at(-1)!
    expect(next.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { next.click() })
    expect(presentedStep.value?.index).toBe(2)

    await act(async () => { key(presenter, 'Escape') })
    expect(storyPresentationActive.value).toBe(false)
    expect(container.querySelector('[data-story-presenter]')).toBeNull()
    expect(modalLayerOpen.value).toBe(false)
  })

  it('jumps to the first and last steps with Home and End, and pages with PageUp and PageDown', async () => {
    const presenter = await present(1)
    await act(async () => { key(presenter, 'End') })
    expect(presentedStep.value?.index).toBe(2)
    await act(async () => { key(presenter, 'Home') })
    expect(presentedStep.value?.index).toBe(0)
    await act(async () => { key(presenter, 'PageDown') })
    expect(presentedStep.value?.index).toBe(1)
    await act(async () => { key(presenter, 'PageUp') })
    expect(presentedStep.value?.index).toBe(0)
    // Modified keys belong to the browser.
    await act(async () => { key(presenter, 'ArrowRight', { ctrlKey: true }) })
    expect(presentedStep.value?.index).toBe(0)
  })

  it('goes full screen with the button or F where the window allows it, and leaves it on Leave', async () => {
    const requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: requestFullscreen, configurable: true })
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true })
    try {
      const presenter = await present(0)
      const toggle = presenter.querySelector<HTMLButtonElement>('button[aria-label="Full screen"]')!
      await act(async () => { toggle.click() })
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(presenter.querySelector('button[aria-label="Exit full screen"]')?.getAttribute('aria-pressed')).toBe('true')
      await act(async () => { key(presenter, 'f') })
      expect(exitFullscreen).toHaveBeenCalledTimes(1)
      await act(async () => { key(presenter, 'F') })
      expect(requestFullscreen).toHaveBeenCalledTimes(2)

      await act(async () => { presenter.querySelector<HTMLButtonElement>('[data-presenter-leave]')!.click() })
      expect(exitFullscreen).toHaveBeenCalledTimes(2)
      expect(storyPresentationActive.value).toBe(false)
    } finally {
      Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true })
    }
  })

  it('offers no full screen where the window cannot go full screen', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true })
    const presenter = await present(0)
    expect(presenter.querySelector('button[aria-label="Full screen"]')).toBeNull()
    const event = key(presenter, 'f')
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps Tab inside the presenter', async () => {
    const presenter = await present(0)
    const controls = [...presenter.querySelectorAll<HTMLElement>('button, a[href]')]
    controls.at(-1)!.focus()
    await act(async () => { key(controls.at(-1)!, 'Tab') })
    expect(document.activeElement).toBe(controls[0])
    await act(async () => { key(controls[0]!, 'Tab', { shiftKey: true }) })
    expect(document.activeElement).toBe(controls.at(-1))
  })

  it('moves by swiping on a touch screen', async () => {
    const presenter = await present(1)
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 400 }) as MouseEvent & { pointerId: number; pointerType: string }
      Object.defineProperty(event, 'pointerId', { value: 3 })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      return event
    }
    await act(async () => {
      presenter.dispatchEvent(pointer('pointerdown', 300))
      presenter.dispatchEvent(pointer('pointerup', 200))
    })
    expect(presentedStep.value?.index).toBe(2)
    await act(async () => {
      presenter.dispatchEvent(pointer('pointerdown', 100))
      presenter.dispatchEvent(pointer('pointerup', 300))
    })
    expect(presentedStep.value?.index).toBe(1)
    await act(async () => {
      presenter.dispatchEvent(pointer('pointerdown', 100))
      presenter.dispatchEvent(pointer('pointerup', 120))
    })
    expect(presentedStep.value?.index).toBe(1)
  })

  it('hides the editing chrome while presenting', async () => {
    await act(async () => {
      render(<PanelRail label="Panels" groups={[[{ id: 'nav.layers', label: 'Layers', disabled: false, panel: 'layers', action: () => undefined }]]} />, container)
    })
    expect(container.querySelector('nav')).not.toBeNull()
    await act(async () => { presentStory('tour', 0, { reducedMotion: true }) })
    expect(container.querySelector('nav')).toBeNull()
    await act(async () => { leaveStoryPresentation() })
    expect(container.querySelector('nav')).not.toBeNull()
  })
})
