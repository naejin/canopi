import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { locale } from '../app/settings/state'
import { t } from '../i18n'
import { activePanel, sidePanel } from '../app/shell/state'
import { ToolCard } from '../components/canvas/ToolCard'
import { StampChooser } from '../components/canvas/StampChooser'
import { clearPlantStampSource, selectPlantStampSource } from '../canvas/plant-stamp-source'
import {
  beginSavedObjectStampPlacement,
  clearSavedObjectStampSource,
} from '../canvas/saved-object-stamp-source'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import {
  IDLE_CANVAS_TOOL_GUIDANCE,
  setCanvasTool,
  setCanvasToolGuidance,
  type CanvasPlantRowGuidance,
  type CanvasToolGuidance,
} from '../canvas/session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'

const locating = vi.hoisted(() => ({ open: null as null | { value: boolean } }))
vi.mock('../app/site-onboarding/state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/site-onboarding/state')>()
  const { signal } = await import('@preact/signals')
  const open = signal(false)
  locating.open = open
  return { ...original, siteLocateOpen: open }
})

const savedStamps = vi.hoisted(() => ({ items: [] as import('../types/saved-object-stamps').SavedObjectStamp[] }))
vi.mock('../ipc/saved-object-stamps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/saved-object-stamps')>()),
  getSavedObjectStamps: vi.fn(async () => savedStamps.items),
}))

function savedStamp(id: string, name: string, canonicalNames: readonly string[]) {
  return {
    id,
    name,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    payload_json: JSON.stringify({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: canonicalNames.map((canonicalName, index) => ({
        id: `${id}-${index}`, canonicalName, commonName: null, color: null, position: { x: index, y: 0 }, rotationDeg: null, scale: null,
      })),
      zones: [],
      annotations: [],
      groups: [],
    }),
  }
}

const APPLE = { canonical_name: 'Malus domestica', common_name: 'Apple', stratum: 'high', width_max_m: 6 }

describe('Tool card', () => {
  let container: HTMLDivElement

  beforeEach(async () => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    setCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface(),
      queries: createTestCanvasQuerySurface(),
      documents: createTestCanvasDocumentSurface(),
    })
    await act(() => render(<ToolCard canvasRef={{ current: null }} />, container))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCanvasTool('select')
    setCanvasToolGuidance(IDLE_CANVAS_TOOL_GUIDANCE)
    clearPlantStampSource()
    clearSavedObjectStampSource()
    locating.open!.value = false
    setCanvasRuntimeSurfaces(null)
    sidePanel.value = null
    activePanel.value = 'canvas'
  })

  async function choose(tool: string, guidance: Partial<CanvasToolGuidance> = {}): Promise<void> {
    await act(() => {
      setCanvasTool(tool)
      setCanvasToolGuidance({ ...IDLE_CANVAS_TOOL_GUIDANCE, ...guidance })
    })
  }

  const card = () => container.querySelector<HTMLElement>('[data-tool-card]')
  const live = () => container.querySelector<HTMLElement>('[role="status"]')!
  const lines = () => [...live().children].map((line) => line.textContent)

  it('shows no card for Select and Pan, but keeps its live region mounted', async () => {
    expect(card()).toBeNull()
    expect(live().getAttribute('aria-live')).toBe('polite')
    expect(live().textContent).toBe('')

    await choose('hand')
    expect(card()).toBeNull()
  })

  it('names the species for Place plants, offers Change species and says Esc stops placing', async () => {
    selectPlantStampSource(APPLE)
    await choose('plant-stamp')

    expect(card()!.getAttribute('aria-label')).toBe('Place plants')
    // The species takes its own line, so the instruction never breaks around it.
    expect(lines()).toEqual(['Place plants', 'Apple', 'click the map to place one', 'Esc to stop placing'])
    expect(live().querySelector('b')?.textContent).toBe('Apple')
    expect(card()!.querySelector('button')?.textContent).toBe('Change species')
  })

  it('names a species with no name in the interface language by its English name, marked', async () => {
    await act(() => {
      locale.value = 'fr'
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface(),
        queries: createTestCanvasQuerySurface({ englishFallbackNames: new Map([['Malus domestica', 'Apple']]) }),
        documents: createTestCanvasDocumentSurface(),
      })
    })
    selectPlantStampSource({ ...APPLE, common_name: null })
    await choose('plant-stamp')

    const subject = live().querySelector('b')!
    expect(subject.querySelector('[lang="en"]')?.textContent).toBe('Apple')
    expect(subject.textContent).toContain(t('speciesName.englishMark'))
    expect(subject.textContent).toContain(t('speciesName.englishFallbackNote'))
  })

  it('prefers the name in the interface language over the one saved with the source', async () => {
    await act(() => {
      locale.value = 'fr'
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface(),
        queries: createTestCanvasQuerySurface({ localizedNames: new Map([['Malus domestica', 'Pommier']]) }),
        documents: createTestCanvasDocumentSurface(),
      })
    })
    selectPlantStampSource(APPLE)
    await choose('plant-stamp')
    expect(live().querySelector('b')?.textContent).toBe('Pommier')
  })

  it('leads the card with the species glyph in the colour and symbol a click places', async () => {
    await act(() => {
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface(),
        queries: createTestCanvasQuerySurface({
          scene: {
            ...createDefaultScenePersistedState(),
            plantSpeciesColors: { 'Malus domestica': '#b06045' },
            plantSpeciesSymbols: { 'Malus domestica': 'apple' },
          },
        }),
        documents: createTestCanvasDocumentSurface(),
      })
    })
    selectPlantStampSource(APPLE)
    await choose('plant-stamp')

    const lead = card()!.querySelector<HTMLElement>('[data-tool-card-lead]')!
    expect(lead.getAttribute('aria-hidden')).toBe('true')
    expect(lead.querySelector('svg')?.getAttribute('data-plant-symbol')).toBe('apple')
    expect(lead.style.color).toBe('rgb(176, 96, 69)')

    // No species yet: no glyph.
    await act(() => { clearPlantStampSource() })
    expect(card()!.querySelector('[data-tool-card-lead]')).toBeNull()
  })

  it('leads a stamp card with the stamp icon, and drawing tools with none', async () => {
    await choose('object-stamp', { stamp: { kind: 'group', name: 'Pear guild', plants: 10, species: 4 } })
    expect(card()!.querySelector('[data-tool-card-lead="stamp"] svg')).not.toBeNull()
    await choose('polygon')
    expect(card()!.querySelector('[data-tool-card-lead]')).toBeNull()
  })

  it('announces a tool change in the same live region', async () => {
    const region = live()
    await choose('polygon')
    expect(live()).toBe(region)
    expect(region.textContent).toContain('Polygon zone')

    await choose('measurement-guide')
    expect(live()).toBe(region)
    expect(lines()).toEqual([
      'Measure',
      'Drag from one point to another to measure. The line stays as a guide.',
      'Esc to go back to Select',
    ])
  })

  it('switches the Esc meaning to cancel while a polygon is being drawn', async () => {
    await choose('polygon')
    expect(lines()).toEqual([
      'Polygon zone',
      'Click to add corners. Click the first corner or press Enter to finish.',
      'Backspace removes the last corner · Shift keeps 45° angles · Esc to go back to Select',
    ])

    await choose('polygon', { gesture: true })
    expect(lines()[2]).toBe('Backspace removes the last corner · Shift keeps 45° angles · Esc to cancel')
  })

  it.each([
    ['rectangle', 'Rectangle zone', 'Drag across the map to draw the rectangle.'],
    ['ellipse', 'Ellipse zone', 'Drag across the map to draw the ellipse.'],
    ['line', 'Line zone', 'Drag along the map to draw the line.'],
  ])('explains the %s gesture', async (tool, title, instruction) => {
    await choose(tool)
    expect(lines()).toEqual([title, instruction, 'Esc to go back to Select'])
  })

  it('tells how to place a text note, then how to finish it', async () => {
    await choose('text')
    expect(lines()).toEqual(['Text note', 'Click the map where the note goes.', 'Esc to go back to Select'])

    await choose('text', { gesture: true })
    expect(lines()).toEqual([
      'Text note',
      'Type the note. Enter to finish.',
      'Shift Enter for a new line · Esc to cancel',
    ])
  })

  it('asks for an object to copy, then names the stamp with its plant and species counts', async () => {
    await choose('object-stamp')
    expect(lines()).toEqual(['Place a stamp', 'Click a plant, zone, note or group to copy it', 'Esc to stop placing'])

    await choose('object-stamp', { stamp: { kind: 'group', name: 'Pear guild', plants: 10, species: 4 }, stampRotationDeg: 0 })
    expect(lines().slice(1, 3)).toEqual(['Pear guild', '10 plants · 4 species · click to place'])

    await choose('object-stamp', { stamp: { kind: 'zone', name: null, plants: 0, species: 0 } })
    expect(lines().slice(1, 3)).toEqual(['Zone', 'click to place'])
  })

  it('tells how to turn a held stamp and shows its angle once turned', async () => {
    const guild = { kind: 'group', name: 'Pear guild', plants: 10, species: 4 } as const
    await choose('object-stamp', { stamp: guild, stampRotationDeg: 0 })
    expect(lines().slice(1)).toEqual(['Pear guild', '10 plants · 4 species · click to place', '[ and ] rotate by 15° · Esc to stop placing'])

    await choose('object-stamp', { stamp: guild, stampRotationDeg: 30 })
    expect(lines().slice(1)).toEqual(['Pear guild', '10 plants · 4 species · turned 30° · click to place', '[ and ] rotate by 15° · Esc to stop placing'])
  })

  describe('Change stamp', () => {
    afterEach(() => { savedStamps.items = [] })

    it('opens a chooser of saved stamps that arms the chosen one and gives the map focus back', async () => {
      savedStamps.items = [savedStamp('stamp-1', 'Guilde pommier', ['Malus domestica', 'Rubus idaeus']), savedStamp('stamp-2', '', ['Malus domestica'])]
      const setTool = vi.fn((tool: string) => setCanvasTool(tool))
      const map = document.createElement('div')
      map.tabIndex = 0
      document.body.append(map)
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface({ tools: { setTool } }),
        queries: createTestCanvasQuerySurface(),
        documents: createTestCanvasDocumentSurface(),
      })
      await act(() => render(<ToolCard canvasRef={{ current: map }} stampChooser={StampChooser} />, container))
      await choose('object-stamp', { stamp: { kind: 'plant', name: 'Apple', plants: 1, species: 1 }, stampRotationDeg: 0 })

      const link = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Change stamp')!
      await act(() => link.click())
      await vi.waitFor(() => expect(container.querySelectorAll('[data-stamp-option]')).toHaveLength(2))
      const options = [...container.querySelectorAll<HTMLButtonElement>('[data-stamp-option]')]
      expect(options.map((option) => option.textContent)).toEqual(['Guilde pommier2 plants · 2 species', 'Untitled stamp1 plant'])
      expect(document.activeElement).toBe(options[0])

      await act(() => options[0]!.click())
      expect(setTool).toHaveBeenLastCalledWith('saved-object-stamp')
      expect(container.querySelector('[data-stamp-chooser]')).toBeNull()
      expect(document.activeElement).toBe(map)
      expect(lines()[1]).toBe('Guilde pommier')
      map.remove()
    })

    it('is not offered where the edition keeps no saved stamps (Web)', async () => {
      await choose('object-stamp', { stamp: { kind: 'plant', name: 'Apple', plants: 1, species: 1 }, stampRotationDeg: 0 })
      expect([...container.querySelectorAll('button')].map((button) => button.textContent)).not.toContain('Change stamp')
    })

    it('offers copying an object from the map instead, and closes on Esc', async () => {
      const setTool = vi.fn((tool: string) => setCanvasTool(tool))
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface({ tools: { setTool } }),
        queries: createTestCanvasQuerySurface(),
        documents: createTestCanvasDocumentSurface(),
      })
      await act(() => render(<ToolCard canvasRef={{ current: null }} stampChooser={StampChooser} />, container))
      await choose('object-stamp')
      // Before anything is picked the card offers the saved stamps.
      const link = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Choose a saved stamp')!
      await act(() => link.click())
      await vi.waitFor(() => expect(container.querySelector('[data-stamp-chooser]')?.textContent).toContain('No saved stamps yet'))

      const copy = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Copy an object on the map')!
      await act(() => copy.click())
      // Leaving and re-arming Place a stamp drops what it held, so the next click picks again.
      expect(setTool.mock.calls.map(([tool]) => tool)).toEqual(['select', 'object-stamp'])
      expect(container.querySelector('[data-stamp-chooser]')).toBeNull()

      await act(() => link.click())
      const chooser = container.querySelector<HTMLElement>('[data-stamp-chooser]')!
      await act(() => { chooser.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(container.querySelector('[data-stamp-chooser]')).toBeNull()
    })
  })

  it('names a saved stamp from Favorites with its counts', async () => {
    const setTool = (tool: string) => setCanvasTool(tool)
    await act(() => {
      beginSavedObjectStampPlacement({
        id: 'stamp-1',
        name: 'Guilde pommier',
        sort_order: 0,
        created_at: '',
        updated_at: '',
        payload_json: JSON.stringify({
          version: 2,
          anchor: { x: 0, y: 0 },
          plants: [
            { id: 'a', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, position: { x: 0, y: 0 }, rotationDeg: null, scale: null },
            { id: 'b', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, position: { x: 1, y: 0 }, rotationDeg: null, scale: null },
            { id: 'c', canonicalName: 'Rubus idaeus', commonName: 'Raspberry', color: null, position: { x: 2, y: 0 }, rotationDeg: null, scale: null },
          ],
          zones: [],
          annotations: [],
          groups: [],
        }),
      }, { setTool } as never)
    })

    expect(lines()).toEqual(['Place a stamp', 'Guilde pommier', '3 plants · 2 species · click to place', '[ and ] rotate by 15° · Esc to stop placing'])
  })

  describe('Plant a row', () => {
    const ROW: CanvasPlantRowGuidance = {
      phase: 'row', plantName: 'Apple', glyph: { symbol: 'berry', color: '#ab5268' }, interval: '50 cm', intervalValid: true, count: null, density: 'normal', focusRequest: 1,
    }
    const field = () => container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')
    const count = () => container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')
    let spacing: {
      input: Mock<(text: string) => void>
      commit: Mock<(text: string) => void>
      blur: Mock<(text: string) => void>
      cancel: Mock<() => void>
    }

    beforeEach(async () => {
      spacing = { input: vi.fn(), commit: vi.fn(), blur: vi.fn(), cancel: vi.fn() }
      await act(() => {
        setCanvasRuntimeSurfaces({
          commands: createTestCanvasCommandSurface({ tools: { plantRowSpacing: spacing } }),
          queries: createTestCanvasQuerySurface(),
          documents: createTestCanvasDocumentSurface(),
        })
      })
    })

    it('asks for a plant to repeat in the shared card, then says a missed click needs a usable plant', async () => {
      await choose('plant-spacing', { plantRow: { ...ROW, phase: 'pick', plantName: null, glyph: null, focusRequest: 0 } })
      expect(card()!.getAttribute('data-tool-card')).toBe('plant-spacing')
      expect(lines()).toEqual(['Plant a row', 'Click a placed plant to repeat it along a row', 'Esc to go back to Select'])
      expect(field()).toBeNull()

      await choose('plant-spacing', { plantRow: { ...ROW, phase: 'missed', plantName: null, glyph: null, focusRequest: 0 } })
      expect(lines()).toEqual(['Plant a row', 'Click a visible, unlocked placed plant', 'Esc to go back to Select'])
    })

    it('names the picked plant, holds the spacing field and counts the row with its density', async () => {
      await choose('plant-spacing', { gesture: true, plantRow: ROW })
      expect(lines().slice(1, 3)).toEqual(['Apple', 'drag along the row'])
      expect(live().querySelector('b')?.textContent).toBe('Apple')
      const lead = card()!.querySelector<HTMLElement>('[data-tool-card-lead]')!
      expect(lead.querySelector('svg')?.getAttribute('data-plant-symbol')).toBe('berry')
      expect(lead.style.color).toBe('rgb(171, 82, 104)')
      expect(live().textContent).toContain('Shift keeps 45° angles · Esc to cancel')
      const input = field()!
      expect(input.value).toBe('50 cm')
      expect(input.getAttribute('inputmode')).toBe('decimal')
      expect(input.getAttribute('aria-invalid')).toBe('false')
      expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Interval')
      expect(count()).toBeNull()

      await choose('plant-spacing', { gesture: true, plantRow: { ...ROW, count: 3 } })
      expect(count()!.textContent).toBe('3 generated')
      expect(count()!.dataset.density).toBe('normal')
      // The count changes with every pointer move, so it is not announced.
      expect(count()!.closest('[aria-live="off"]')).not.toBeNull()

      await choose('plant-spacing', { gesture: true, plantRow: { ...ROW, count: 140, density: 'dense' } })
      expect(count()!.dataset.density).toBe('dense')

      await choose('plant-spacing', { gesture: true, plantRow: { ...ROW, count: 6000, density: 'blocked', intervalValid: false } })
      expect(count()!.textContent).toBe('6000 generated · Increase interval or shorten the line')
      expect(count()!.dataset.density).toBe('blocked')
      expect(field()!.getAttribute('aria-invalid')).toBe('true')
    })

    it('focuses the spacing field on request and drives it from the keyboard', async () => {
      await choose('plant-spacing', { gesture: true, plantRow: ROW })
      const input = field()!
      expect(document.activeElement).toBe(input)

      input.value = '0,75m'
      await act(() => { input.dispatchEvent(new Event('input', { bubbles: true })) })
      expect(spacing.input).toHaveBeenCalledWith('0,75m')

      const onWindowKeyDown = vi.fn()
      window.addEventListener('keydown', onWindowKeyDown)
      try {
        await act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
        expect(spacing.commit).toHaveBeenCalledWith('0,75m')
        await act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
        expect(spacing.cancel).toHaveBeenCalledOnce()
        // Enter and Esc belong to the field; other keys (Ctrl S) still reach the shortcuts.
        expect(onWindowKeyDown).not.toHaveBeenCalled()
        await act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })) })
        expect(onWindowKeyDown).toHaveBeenCalledOnce()
      } finally {
        window.removeEventListener('keydown', onWindowKeyDown)
      }

      // Leaving the field keeps a valid spacing without moving focus.
      const typed = input.value
      await act(() => { input.blur() })
      expect(spacing.blur).toHaveBeenCalledWith(typed)

      // An invalid spacing kept on Enter asks for the field again.
      const other = document.createElement('button')
      document.body.append(other)
      other.focus()
      await choose('plant-spacing', { gesture: true, plantRow: { ...ROW, intervalValid: false, focusRequest: 2 } })
      expect(document.activeElement).toBe(field())
      other.remove()
    })

    it('keeps the field, its text, focus and selection when the language changes', async () => {
      await choose('plant-spacing', { gesture: true, plantRow: { ...ROW, interval: '2 m', count: 3 } })
      const input = field()!
      input.focus()
      input.setSelectionRange(1, 3)

      await act(() => { locale.value = 'fr' })

      expect(field()).toBe(input)
      expect(input.value).toBe('2 m')
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(1)
      expect(input.selectionEnd).toBe(3)
      expect(lines()[0]).toBe(t('canvas.tools.plantSpacing'))
      expect(lines()[0]).not.toBe('Plant a row')
      expect(count()!.textContent).toBe(t('canvas.plantSpacing.generatedCount', { count: 3 }))
    })
  })

  it('hides while "Where is your site?" shows and in overview', async () => {
    await choose('polygon')
    await act(() => { locating.open!.value = true })
    expect(card()).toBeNull()

    await act(() => {
      locating.open!.value = false
      setCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface(),
        queries: createTestCanvasQuerySurface({ viewport: { x: 0, y: 0, scale: 0.01 } }),
        documents: createTestCanvasDocumentSurface(),
      })
    })
    expect(card()).toBeNull()
  })
})
