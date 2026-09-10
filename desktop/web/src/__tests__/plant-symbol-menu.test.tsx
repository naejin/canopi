import { readFileSync } from 'node:fs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlantSymbolMenu } from '../components/canvas/PlantSymbolMenu'
import { setCurrentCanvasSession } from '../canvas/session'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import { selectedObjectIds } from '../canvas/session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('PlantSymbolMenu', () => {
  let container: HTMLDivElement
  let querySurface: ReturnType<typeof createTestCanvasQuerySurface>
  const setSelectedPlantSymbol = vi.fn()
  const setPlantSymbolForSpecies = vi.fn()
  const clearPlantSpeciesSymbol = vi.fn()
  const getSelectedPlantSymbolContext = vi.fn()
  const buttonRef = { current: null as HTMLButtonElement | null }

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    setSelectedPlantSymbol.mockReset()
    setPlantSymbolForSpecies.mockReset()
    clearPlantSpeciesSymbol.mockReset()
    getSelectedPlantSymbolContext.mockReset()
    querySurface = createTestCanvasQuerySurface()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        plantPresentation: {
          setSelectedPlantSymbol,
          setPlantSymbolForSpecies,
          clearPlantSpeciesSymbol,
        },
      }),
      queries: {
        ...querySurface,
        getSelectedPlantSymbolContext,
      },
    }))
    buttonRef.current = document.createElement('button')
    selectedObjectIds.value = new Set(['plant-1'])
    plantSymbolMenuOpen.value = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantSymbolMenuOpen.value = false
    setCurrentCanvasSession(null)
  })

  it('applies a labeled symbol choice to the current plant selection', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const coniferButton = container.querySelector<HTMLButtonElement>('button[aria-label="Conifer"]')
    expect(coniferButton).not.toBeNull()
    expect(coniferButton?.title).toBe('Conifer')
    expect(coniferButton?.textContent).toBe('Conifer')

    await act(async () => {
      coniferButton?.click()
      await Promise.resolve()
    })

    const setSymbolButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set symbol'),
    ) as HTMLButtonElement

    await act(async () => {
      setSymbolButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantSymbol).toHaveBeenCalledWith('conifer')
    expect(plantSymbolMenuOpen.value).toBe(false)
  })

  it('offers the twelve botanical forms in one keyboard grid', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const symbolRows = container.querySelectorAll('[role="listbox"]')
    expect(symbolRows).toHaveLength(1)
    expect(symbolRows[0]?.querySelectorAll('[role=option]')).toHaveLength(12)
    expect(symbolRows[0]?.textContent).toContain('Groundcover')
    expect(symbolRows[0]?.querySelector('button[aria-label="Groundcover"]')).toBeTruthy()
    expect(symbolRows[0]?.querySelector('button[aria-label="Fern"]')).toBeTruthy()

    const fernButton = symbolRows[0]?.querySelector<HTMLButtonElement>('button[aria-label="Fern"]')
    expect(fernButton?.textContent).toBe('Fern')

    await act(async () => {
      fernButton?.click()
      await Promise.resolve()
    })

    const setSymbolButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set symbol'),
    ) as HTMLButtonElement

    await act(async () => {
      setSymbolButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantSymbol).toHaveBeenCalledWith('fern')
  })

  it('renders option and preview glyphs in normalized SVG frames', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const [previewSvg] = container.querySelectorAll('svg')
    const coniferSvg = container.querySelector('button[aria-label="Conifer"] svg')

    expect(previewSvg).toBeTruthy()
    expect(coniferSvg).toBeTruthy()
    expect(previewSvg?.getAttribute('viewBox')).toBe('-1 -1 2 2')
    expect(coniferSvg?.getAttribute('viewBox')).toBe('-1 -1 2 2')
  })

  it('uses a defined preview sizing token for the symbol preview frame', () => {
    const css = readFileSync('src/components/canvas/PlantSymbolMenu.module.css', 'utf8')
    const previewRule = css.match(/\.preview\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(previewRule).toContain('--symbol-preview-min-height:')
    expect(previewRule).toContain('min-height: var(--symbol-preview-min-height);')
    expect(previewRule).not.toContain('var(--space-10)')
  })

  it('sizes the popover for three four-symbol rows', () => {
    const css = readFileSync('src/components/canvas/PlantSymbolMenu.module.css', 'utf8')
    const menuRule = css.match(/\.menu\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const gridRule = css.match(/\.grid\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(menuRule).toContain('width: 360px;')
    expect(gridRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));')
  })

  it('updates the selected plant name when localized plant names refresh', async () => {
    let commonName = 'Apple'
    getSelectedPlantSymbolContext.mockImplementation(() => ({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: commonName,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    }))

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Apple')

    commonName = 'Pommier'
    await act(async () => {
      querySurface.bumpPlantNamesRevision()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Pommier')
    expect(container.textContent).not.toContain('Apple')
  })

  it('keeps a shared inherited effective symbol when applying an unchanged multi-species selection', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'canopy',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const canopyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Canopy tree"]')
    expect(canopyButton?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('Inherited: Canopy tree')

    const setSymbolButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set symbol'),
    ) as HTMLButtonElement

    await act(async () => {
      setSymbolButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantSymbol).toHaveBeenCalledWith('canopy')
    expect(setSelectedPlantSymbol).not.toHaveBeenCalledWith('round')
  })

  it('describes mixed inherited effective symbols without presenting them as inherited round', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'mixed',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const roundButton = container.querySelector<HTMLButtonElement>('button[aria-label="Neutral dot"]')
    expect(roundButton?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Mixed symbols')
    expect(container.textContent).not.toContain('Inherited: Neutral dot')
  })

  it('applies the selected symbol to all placed instances of the selected species', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: 'round',
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const canopyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Canopy tree"]')
    await act(async () => {
      canopyButton?.click()
      await Promise.resolve()
    })

    const setAllButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set for all Apple'),
    ) as HTMLButtonElement

    await act(async () => {
      setAllButton.click()
      await Promise.resolve()
    })

    expect(setPlantSymbolForSpecies).toHaveBeenCalledWith('Malus domestica', 'canopy')
    expect(plantSymbolMenuOpen.value).toBe(false)
  })

  it('stops the action surface at the two apply buttons', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: 'conifer',
      sharedEffectiveSymbol: 'conifer',
      inheritedSymbol: 'round',
      singleSpeciesDefaultSymbol: 'round',
      canClearSelectedSymbol: true,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const actionButtons = [...container.querySelectorAll('button')]
      .map((button) => button.textContent?.trim())
      .filter(Boolean)

    expect(actionButtons).toContain('Set symbol')
    expect(actionButtons).toContain('Set for all Apple')
    expect(container.textContent).not.toContain('Sets the default symbol')
    expect(actionButtons.some((label) => label?.includes('Clear symbol'))).toBe(false)
    expect(actionButtons.some((label) => label?.includes('Clear species default'))).toBe(false)
  })

})
