import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState, type ScenePlantEntity } from '../canvas/runtime/scene'
import { SCALE_BAR_RESERVED_BOTTOM_PX } from '../canvas/scale-bar'
import { setCurrentCanvasSession } from '../canvas/session'
import { DisplayLegend } from '../components/canvas/DisplayLegend'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

const DISPLAY_LEGEND_TOP_RESERVED_PX = 32

describe('DisplayLegend', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('shows grouped pinned plant names', async () => {
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

  it('lets large pinned-name legends use available canvas height before scrolling', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = Array.from({ length: 12 }, (_, index) =>
      plant({
        id: `plant-${index}`,
        canonicalName: `Species ${index}`,
        commonName: `Species ${index}`,
        pinnedName: true,
        color: `#1122${index.toString(16).padStart(2, '0')}`,
      }),
    )
    const query = createTestCanvasQuerySurface({ scene })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: query }))

    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    const legend = container.querySelector<HTMLElement>('[data-pinned-plant-name-legend]')
    expect(legend?.style.maxHeight).toBe(
      `calc(100% - ${SCALE_BAR_RESERVED_BOTTOM_PX + DISPLAY_LEGEND_TOP_RESERVED_PX}px)`,
    )
    expect(legend?.style.overflowY).toBe('auto')
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

  it('hides the pinned-name legend when plant layer visibility makes it inapplicable', async () => {
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
