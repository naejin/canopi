import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState, type ScenePlantEntity } from '../canvas/runtime/scene'
import { readFileSync } from 'node:fs'
import { setCurrentCanvasSession } from '../canvas/session'
import { DisplayLegend } from '../components/canvas/DisplayLegend'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { buildPinnedPlantNameLegendEntries } from '../canvas/pinned-plant-name-legend'
import { resolvePlantDisplayColor } from '../canvas/runtime/plant-presentation'
import { DEFAULT_PLANT_DISPLAY } from '../canvas/runtime/plant-display'
import type { SpeciesCacheEntry } from '../canvas/runtime/species-cache'


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

    expect(container.querySelectorAll('[data-pinned-plant-name-entry]')).toHaveLength(12)
    // Between the title bar and the bottom chrome, then it scrolls.
    const css = readFileSync('src/components/canvas/DisplayLegend.module.css', 'utf8')
    const legendRule = /\.legend \{(?<body>[^}]*)\}/.exec(css)?.groups?.body ?? ''
    expect(legendRule).toContain('max-height: calc(100% - var(--chrome-rail-top) - var(--chrome-bottom))')
    expect(legendRule).toContain('overflow-y: auto')
  })

  it('rises above the rulers hint while the hint shows, so the hint never covers its last rows (spec §4.6)', () => {
    // The hint (data-rulers-north-hint) stands above the view chip in the chip's wrapper, a sibling before the legend.
    const css = readFileSync('src/components/canvas/DisplayLegend.module.css', 'utf8')
    const raised = /:global\(\*:has\(> \[data-rulers-north-hint\]\)\) ~ \.legend \{(?<body>[^}]*)\}/.exec(css)?.groups?.body ?? ''
    expect(raised).toContain(
      'bottom: calc(var(--chrome-inset) + var(--control-size-3xl) + var(--space-2) + var(--control-size-2xl) + var(--space-2))',
    )
    expect(raised).toContain(
      'max-height: calc(100% - var(--chrome-rail-top) - var(--chrome-inset) - var(--control-size-3xl) - var(--control-size-2xl) - 2 * var(--space-2))',
    )
  })

  it('stays at the bottom chrome on a narrow canvas, where the view chip and the rulers hint are hidden', () => {
    // The chip's narrow-canvas rule hides its wrapper but the hint stays in the DOM, so the raised rule must carry the
    // complementary container condition or the legend floats over an empty gap with a shortened max-height.
    const chip = readFileSync('src/components/canvas/ViewChip.module.css', 'utf8')
    const breakpoint = /@container \(max-width: (?<px>\d+)px\) \{\s*\.wrapper \{\s*display: none;/.exec(chip)?.groups?.px
    expect(breakpoint).toBe('600')
    const css = readFileSync('src/components/canvas/DisplayLegend.module.css', 'utf8')
    const wide = new RegExp(`@container \\(width > ${breakpoint}px\\) \\{(?<body>[\\s\\S]*?)\\n\\}`).exec(css)
    expect(wide?.groups?.body ?? '').toMatch(/:global\(\*:has\(> \[data-rulers-north-hint\]\)\) ~ \.legend \{/)
    expect(css.replace(wide?.[0] ?? '', '')).not.toContain('data-rulers-north-hint')
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

  // A20 (open bug): an opened Design's plants carry no stratum (the codec hydrates `stratum: null`), so the canvas
  // colours a plant with no colour of its own from the species catalog; the legend has no species cache and shows the
  // default colour instead. Remove `.fails` when the legend reads the runtime's species cache.
  it.fails('shows a pinned plant in the colour the canvas paints it, with its stratum from the species catalog', () => {
    const scene = createDefaultScenePersistedState()
    const opened = plant({ pinnedName: true, color: null, stratum: null })
    scene.plants = [opened]
    const speciesCache = new Map<string, SpeciesCacheEntry>([
      ['Malus domestica', { canonical_name: 'Malus domestica', stratum: 'high' } as SpeciesCacheEntry],
    ])
    const source = {
      getSceneSnapshot: () => scene,
      getLocalizedCommonNames: () => new Map<string, string | null>(),
      getSpeciesCache: () => speciesCache,
    }

    const [entry] = buildPinnedPlantNameLegendEntries(source, DEFAULT_PLANT_DISPLAY)

    expect(entry?.color).toBe(resolvePlantDisplayColor(opened, speciesCache, DEFAULT_PLANT_DISPLAY))
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
    notes: null,
    plantedDate: null,
    quantity: null,
    ...overrides,
  }
}
