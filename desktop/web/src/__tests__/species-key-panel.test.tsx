import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpeciesKeyPanel } from '../components/panels/SpeciesKeyPanel'
import { speciesCatalogWorkbench } from '../app/plant-browser'
import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import type {
  CanvasCommandSurface,
  CanvasQuerySurface,
} from '../canvas/runtime/runtime'
import type { SpeciesFocus } from '../canvas/runtime/species-key'
import { SceneStore } from '../canvas/runtime/scene/store'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import { locale } from '../app/settings/state'
import { navigateTo, sidePanel } from '../app/shell/state'

const plants = [
  { id: 'mint-1', canonicalName: 'Mentha spicata', commonName: 'Menthe verte' },
  { id: 'mint-2', canonicalName: 'Mentha spicata', commonName: 'Menthe verte' },
  { id: 'salvia', canonicalName: 'Salvia officinalis', commonName: 'Sauge' },
]

describe('Species key dock', () => {
  let container: HTMLDivElement
  let commands: CanvasCommandSurface
  let queries: CanvasQuerySurface
  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plants = plants.map((plant, index) => ({
        ...plant,
        kind: 'plant',
        locked: false,
        color: '#3E8E4E',
        symbol: 'herb',
        position: { x: index, y: 0 },
        stratum: null,
        canopySpreadM: null,
        rotationDeg: 0,
        scale: 1,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }))
    })
    const baseQueries = createTestCanvasQuerySurface({ scene: store.persisted })
    let focus: SpeciesFocus = { canonicalName: null, showCodes: false }
    queries = { ...baseQueries, getSpeciesFocus: () => focus }
    commands = createTestCanvasCommandSurface({
      speciesFocus: {
        focus: (canonicalName) => {
          focus = { ...focus, canonicalName }
          baseQueries.bumpSceneRevision()
        },
        showCodes: (showCodes) => {
          focus = { ...focus, showCodes }
          baseQueries.bumpSceneRevision()
        },
      },
    })
    setCanvasRuntimeSurfaces({
      commands,
      queries,
      documents: createTestCanvasDocumentSurface(),
    })
  })
  afterEach(() => {
    render(null, container)
    setCanvasRuntimeSurfaces(null)
    container.remove()
    sidePanel.value = null
  })

  it('searches names and codes, counts placements, and focuses without editing or selecting', async () => {
    const before = queries.getSceneSnapshot()
    await act(() => render(<SpeciesKeyPanel />, container))
    expect(container.querySelectorAll('li')).toHaveLength(2)
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!
    await act(() => {
      search.value = 'msp'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = container.querySelector<HTMLButtonElement>('li button')!
    expect(row.textContent).toContain('MSP')
    expect(row.textContent).toContain('Menthe verte')
    expect(row.textContent).toContain('2')
    await act(() => row.click())
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(queries.getSelection()).toEqual([])
    expect(queries.getSceneSnapshot()).toEqual(before)
    expect(commands.history.canUndo.value).toBe(false)
    await act(() => {
      search.value = 'SAUGE'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('li')!.textContent).toContain('SOF')
  })

  it('opens edition-specific detail without focusing plants and returns to its detail trigger', async () => {
    await act(() => render(<SpeciesKeyPanel renderDetail={name => <button onClick={() => speciesCatalogWorkbench.closeSpeciesDetail()}>Back from {name}</button>} />, container))
    const detail = container.querySelector<HTMLButtonElement>('[aria-label="Details for Menthe verte"]')!
    detail.focus()
    await act(async () => detail.click())
    expect(container.textContent).toContain('Back from Mentha spicata')
    expect(queries.getSpeciesFocus().canonicalName).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Details for Menthe verte')
  })

  it('keeps a clearable focus when the key is replaced by Layers', async () => {
    await act(() => {
      navigateTo('species-key')
      commands.speciesFocus.focus('Mentha spicata')
      commands.speciesFocus.showCodes(true)
      render(<SpeciesKeyPanel />, container)
    })
    await act(() => {
      navigateTo('layers')
      render(<SpeciesFocusChip />, container)
    })
    expect(sidePanel.value).toBe('layers')
    expect(container.textContent).toContain('Focus: MSP')
    await act(() =>
      container.querySelector<HTMLButtonElement>('button')!.click(),
    )
    expect(queries.getSpeciesFocus()).toEqual({
      canonicalName: null,
      showCodes: true,
    })
    expect(container.textContent).toBe('')
  })
})
