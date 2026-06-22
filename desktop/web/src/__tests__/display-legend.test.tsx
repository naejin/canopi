import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { plantColorByAttr, plantSizeMode } from '../canvas/plant-display-state'
import { createDefaultScenePersistedState, type ScenePlantEntity } from '../canvas/runtime/scene'
import { setCurrentCanvasSession } from '../canvas/session'
import { DisplayLegend } from '../components/canvas/DisplayLegend'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

describe('DisplayLegend', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    plantColorByAttr.value = null
    plantSizeMode.value = 'default'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    plantColorByAttr.value = null
    plantSizeMode.value = 'default'
  })

  it('reacts to color-by signal changes while mounted', async () => {
    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Legend')

    await act(async () => {
      plantColorByAttr.value = 'flower'
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Legend')
  })

  it('shows grouped pinned plant names when neutral display settings are active', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [
      plant({ id: 'plant-1', pinnedName: true, color: '#112233', symbol: 'tree' }),
      plant({ id: 'plant-2', pinnedName: true, color: '#112233', symbol: 'tree' }),
      plant({ id: 'plant-3', pinnedName: false, color: '#112233', symbol: 'tree' }),
    ]
    const query = createTestCanvasQuerySurface({
      scene,
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: query }))

    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.querySelector('[data-pinned-plant-name-legend]')).not.toBeNull()
    expect(container.querySelectorAll('[data-pinned-plant-name-entry]')).toHaveLength(1)
    expect(container.textContent).toContain('Pommier')
    expect(container.querySelector('[data-pinned-plant-name-count]')?.textContent).toBe('2')
  })

  it('groups pinned names by localized name, effective symbol, and color', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [
      plant({ id: 'plant-1', pinnedName: true, color: '#112233', symbol: 'tree' }),
      plant({ id: 'plant-2', pinnedName: true, color: '#112233', symbol: 'tree' }),
      plant({ id: 'plant-3', pinnedName: true, color: '#445566', symbol: 'tree' }),
      plant({ id: 'plant-4', pinnedName: true, color: '#112233', symbol: 'shrub' }),
    ]
    const query = createTestCanvasQuerySurface({
      scene,
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: query }))

    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.querySelectorAll('[data-pinned-plant-name-entry]')).toHaveLength(3)
    expect([...container.querySelectorAll('[data-pinned-plant-name-count]')].map((el) => el.textContent)).toEqual(['2'])
  })

  it('updates pinned plant names when pins or localized names change', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [plant({ pinnedName: false })]
    const query = createTestCanvasQuerySurface({ scene })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: query }))

    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.querySelector('[data-pinned-plant-name-legend]')).toBeNull()

    await act(async () => {
      scene.plants[0] = { ...scene.plants[0]!, pinnedName: true }
      query.bumpSceneRevision()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Apple')

    await act(async () => {
      query.setLocalizedNames(new Map([['Malus domestica', 'Pommier']]))
      query.bumpPlantNamesRevision()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Pommier')
    expect(container.textContent).not.toContain('Apple')
  })

  it('hides the pinned-name legend when display settings or plant layer visibility make it inapplicable', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [plant({ pinnedName: true })]
    const query = createTestCanvasQuerySurface({ scene })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: query }))

    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.querySelector('[data-pinned-plant-name-legend]')).not.toBeNull()

    await act(async () => {
      plantSizeMode.value = 'canopy'
      await Promise.resolve()
    })
    expect(container.querySelector('[data-pinned-plant-name-legend]')).toBeNull()

    await act(async () => {
      plantSizeMode.value = 'default'
      plantColorByAttr.value = 'flower'
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Legend')
    expect(container.querySelector('[data-pinned-plant-name-legend]')).toBeNull()

    await act(async () => {
      plantColorByAttr.value = null
      scene.layers = scene.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: false } : layer,
      )
      query.bumpSceneRevision()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-pinned-plant-name-legend]')).toBeNull()
  })
})

function plant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant',
    id: 'plant-1',
    locked: false,
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    symbol: null,
    pinnedName: false,
    stratum: 'tree',
    canopySpreadM: null,
    position: { x: 0, y: 0 },
    rotationDeg: null,
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: null,
    ...overrides,
  }
}
