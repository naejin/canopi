import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebLayersPanel } from '../web/WebLayersPanel'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { locale } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { replaceCurrentDesignState } from './support/design-session-state'
import type { CanopiFile } from '../types/design'

describe('Web Layers', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    mapLayers.value = createDefaultMapLayers()
    setCurrentCanvasSession(null)
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  function mount(lidar: CanopiFile['lidar']): void {
    const file: CanopiFile = {
      version: 9, name: 'Web', description: null, plant_species_colors: {}, plant_species_symbols: {},
      plant_species_codes: {}, layers: [], plants: [], zones: [], annotations: [], measurement_guides: [],
      consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR', created_at: '', updated_at: '',
      extra: {}, lidar,
    }
    replaceCurrentDesignState(file, null, 'Web')
    act(() => { render(<WebLayersPanel />, container) })
  }

  it('offers Satellite, Map or None as the background and says why Site data is empty', () => {
    mount(null)
    const site = container.querySelector('section[aria-labelledby="layers-site"]')!
    expect(site.textContent).toContain('Terrain and height data need Canopi Desktop.')
    expect(site.querySelector('button[aria-haspopup="menu"]')).toBeNull()
    expect(container.textContent).not.toContain('Contour lines')
    expect(container.textContent).not.toContain('Hillshading')
    const background = container.querySelector('section[aria-labelledby="layers-background"]')!
    expect(Array.from(background.querySelectorAll('[role="radio"], input[type="radio"]')).map((input) => (input as HTMLInputElement).value))
      .toEqual(['satellite', 'basemap', 'none'])
  })

  it('counts the terrain layers a Design keeps for Desktop', () => {
    mount({
      schema_version: 1,
      entries: [
        { kind: 'Source', id: 'a', visible: true, opacity: 1, order: 0, style: null },
        { kind: 'Derived', id: 's', visible: true, opacity: 1, order: 1, style: null },
      ],
    })
    expect(container.textContent).toContain('This Design has 2 terrain or height layers.')
  })
})
