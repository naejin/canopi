import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarLayerSummary, LidarLibrarySnapshot } from '../generated/contracts'

const actions = vi.hoisted(() => ({
  moveReference: vi.fn(),
  removeFromDesign: vi.fn(),
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
import { libraryFocusRequest } from '../app/lidar/library-navigation'
import { sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'

function layer(id: string, name: string): LidarLayerSummary {
  return {
    id, name, generation_id: `${id}-g1`, measurement_kind: 'GroundElevation', units: 'm', state: 'Ready',
    resolution_m: 1, coverage_cells: null, bounds: [0, 0, 1, 1], value_range: [100, 200], display_range: null,
    tilesets: [], analysis_count: 0, import_job: null,
  }
}

function library(layers: LidarLayerSummary[]): LidarLibrarySnapshot {
  return { layers, analyses: [], engine: { available: true, version: null, detail: null } }
}

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
    await click(button('Remove from Design'))
    expect(actions.removeFromDesign).toHaveBeenCalledWith('a')
  })

  it('keeps a reference whose library item is gone, labelled unavailable', () => {
    setDesign({ lidar: { entries: [{ kind: 'Source', id: 'gone', order: 0, visible: true, opacity: 1 }] } })
    act(() => { render(<LidarLayersSection />, container) })
    expect(container.textContent).toContain('Unavailable data')
    expect(container.textContent).toContain('Data unavailable')
  })
})
