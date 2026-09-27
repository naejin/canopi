import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { activePanel, sidePanel } from '../app/shell/state'
import { ToolCard } from '../components/canvas/ToolCard'
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
  type CanvasToolGuidance,
} from '../canvas/session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'

const locating = vi.hoisted(() => ({ open: null as null | { value: boolean } }))
vi.mock('../app/site-onboarding/state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/site-onboarding/state')>()
  const { signal } = await import('@preact/signals')
  const open = signal(false)
  locating.open = open
  return { ...original, siteLocateOpen: open }
})

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
    expect(lines()).toEqual(['Place plants', 'Apple · click the map to place one', 'Esc to stop placing'])
    expect(live().querySelector('b')?.textContent).toBe('Apple')
    expect(card()!.querySelector('button')?.textContent).toBe('Change species')
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

    await choose('object-stamp', { stamp: { kind: 'group', name: 'Pear guild', plants: 10, species: 4 } })
    expect(lines()[1]).toBe('Pear guild · 10 plants · 4 species · click to place')

    await choose('object-stamp', { stamp: { kind: 'zone', name: null, plants: 0, species: 0 } })
    expect(lines()[1]).toBe('Zone · click to place')
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
          version: 1,
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

    expect(lines()).toEqual(['Place a stamp', 'Guilde pommier · 3 plants · 2 species · click to place', 'Esc to stop placing'])
  })

  it('leaves Plant a row to its own runtime card', async () => {
    await choose('plant-spacing')
    expect(card()).toBeNull()
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
