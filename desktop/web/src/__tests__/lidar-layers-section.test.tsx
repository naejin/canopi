import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { librarySnapshot, slopeItem, sourceItem } from './support/library-fixtures'

const actions = vi.hoisted(() => ({
  moveReference: vi.fn(),
  removeFromDesign: vi.fn(),
  rerunAnalysis: vi.fn().mockResolvedValue(undefined),
  setLidarEntryOpacity: vi.fn(),
  setLidarEntryVisibility: vi.fn(),
}))

vi.mock('../app/lidar/actions', () => actions)
vi.mock('../ipc/lidar', () => ({
  lidarDisplayDescriptor: vi.fn(() => new Promise(() => {})),
  lidarListLibrary: vi.fn(() => new Promise(() => {})),
  lidarSamplePixel: vi.fn(),
  lidarCancelSamplePixel: vi.fn(),
}))
vi.mock('../app/document-session/store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    currentDesign: signal<unknown>(null),
    designSessionStore: { sessionIdentity: signal('design-a') },
  }
})

import { LidarLayersSection } from '../components/panels/lidar/LidarLayersSection'
import { lidarLibrary } from '../app/lidar/library-store'
import { currentDesign } from '../app/document-session/store'
import { layersFocusRequest, libraryAnalyzeRequest, libraryFocusRequest, showInLayers } from '../app/lidar/library-navigation'
import { sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'

function layer(id: string, name: string) {
  return sourceItem(id, name, { value_range: [100, 200] })
}

const library = librarySnapshot

let container: HTMLDivElement

function setDesign(value: unknown): void {
  (currentDesign as unknown as { value: unknown }).value = value
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) =>
    `${candidate.textContent ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`.includes(label))
  if (!found) throw new Error(`no button ${label}`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('Layers data band', () => {
  beforeEach(() => {
    locale.value = 'en'
    vi.clearAllMocks()
    sidePanel.value = 'layers'
    lidarLibrary.value = library([layer('a', 'Ground'), layer('b', 'Canopy')])
    setDesign({ lidar: { entries: [] } })
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('sends an empty Design to the Data Library to add data', async () => {
    act(() => { render(<LidarLayersSection />, container) })
    expect(container.textContent).toContain('No data in this Design')
    await click(button('Open Data Library'))
    expect(sidePanel.value).toBe('data')
  })

  it('lists references front first and edits only this Design', async () => {
    setDesign({ lidar: { entries: [
      { kind: 'Source', id: 'a', order: 0, visible: true, opacity: 1 },
      { kind: 'Source', id: 'b', order: 1, visible: false, opacity: 0.5 },
    ] } })
    act(() => { render(<LidarLayersSection />, container) })

    const names = Array.from(container.querySelectorAll('li strong')).map((node) => node.textContent)
    expect(names).toEqual(['Canopy', 'Ground'])
    expect(button('Move Canopy forward').disabled).toBe(true)
    expect(button('Move Ground back').disabled).toBe(true)

    await click(button('Show Canopy'))
    await click(button('Move Ground forward'))
    expect(actions.setLidarEntryVisibility).toHaveBeenCalledWith('b', true)
    expect(actions.moveReference).toHaveBeenCalledWith('a', 'front')
  })

  it('shows a legend, links to the library item and removes the reference', async () => {
    setDesign({ lidar: { entries: [{ kind: 'Source', id: 'a', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })
    await click(container.querySelector('li strong')!.closest('button')!)

    expect(container.querySelector('[aria-label="Legend"]')).not.toBeNull()
    await click(button('Open in Data Library'))
    expect(libraryFocusRequest.value).toBe('a')
    expect(sidePanel.value).toBe('data')
    await click(button('Analyze…'))
    expect(libraryAnalyzeRequest.value).toEqual({ itemId: 'a', analysisId: null })
    expect(sidePanel.value).toBe('data')
    await click(button('Remove from Design'))
    expect(actions.removeFromDesign).toHaveBeenCalledWith('a')
  })

  it('keeps a reference whose library item is gone, labelled unavailable', () => {
    setDesign({ lidar: { entries: [{ kind: 'Source', id: 'gone', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })
    expect(container.textContent).toContain('Unavailable data')
    expect(container.textContent).toContain('Data unavailable')
  })

  it('marks an out-of-date result, says why, and refreshes it in place', async () => {
    lidarLibrary.value = library([
      layer('a', 'Ground'),
      slopeItem('s', 'a', { freshness: { state: 'Stale', reasons: [{ reason: 'InputUpdated', input_key: 'dem', item_id: 'a' }] } }),
    ])
    setDesign({ lidar: { entries: [{ kind: 'Analysis', id: 's', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })

    const row = container.querySelector('li')!
    expect(row.textContent).toContain('Out of date')
    await click(button('Refresh Ground · Slope'))
    expect(actions.rerunAnalysis).toHaveBeenCalledWith('s-def')

    await click(container.querySelector('li strong')!.closest('button')!)
    expect(container.textContent).toContain('Ground has changed since this was calculated.')
    expect(container.querySelector('[aria-label="Legend"]')?.textContent).toContain('60.0°')
  })

  it('shows a refresh in progress instead of offering another', () => {
    lidarLibrary.value = library([
      layer('a', 'Ground'),
      slopeItem('s', 'a', {
        freshness: { state: 'Stale', reasons: [{ reason: 'RecipeUpdated', from: 1, to: 2 }] },
        run: { job_id: 'j', state: 'Preparing', message: null },
      }),
    ])
    setDesign({ lidar: { entries: [{ kind: 'Analysis', id: 's', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })
    expect(container.textContent).toContain('Refreshing')
    expect(() => button('Refresh Ground · Slope')).toThrow()
  })

  it('selects the reference the Analyze dialog asked to show', async () => {
    setDesign({ lidar: { entries: [{ kind: 'Source', id: 'a', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })
    expect(container.querySelector('h4')).toBeNull()
    await act(async () => { showInLayers('a') })
    expect(sidePanel.value).toBe('layers')
    expect(layersFocusRequest.value).toBeNull()
    expect(container.querySelector('h4')?.textContent).toBe('Ground')
  })
})
