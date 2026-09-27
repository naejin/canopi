import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recentDesigns = vi.hoisted(() => ({
  files: [] as { path: string; name: string; updated_at: string }[],
  previews: null as null | ((paths: readonly string[]) => Promise<import('../types/design').RecentDesignSummary[]>),
}))

vi.mock('../ipc/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/design')>()),
  getRecentFiles: vi.fn(async () => recentDesigns.files),
  getRecentDesignPreviews: vi.fn(async (paths: readonly string[]) =>
    recentDesigns.previews ? recentDesigns.previews(paths) : new Promise(() => {})),
  listDesignDrafts: vi.fn(async () => []),
}))

import { plantDbStatus } from '../app/health/state'
import { locale } from '../app/settings/state'
import { DegradedBanner } from '../components/shared/DegradedBanner'
import { StartScreen } from '../components/shared/StartScreen'
import { WelcomeScreen } from '../components/shared/WelcomeScreen'

let container: HTMLDivElement

beforeEach(() => {
  locale.value = 'en'
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  plantDbStatus.value = 'available'
})

function renderStart(props: Partial<Parameters<typeof StartScreen>[0]> = {}) {
  const newDesign = { label: 'New Design', run: vi.fn() }
  render(
    <StartScreen
      newDesign={newDesign}
      openDesign={{ label: 'Open Design…', run: vi.fn() }}
      links={[]}
      footer=""
      recent={[]}
      drafts={[]}
      {...props}
    />,
    container,
  )
  return newDesign
}

describe('Start screen on first run', () => {
  it('says where Designs will appear and offers New Design instead of an empty search', async () => {
    let newDesign!: ReturnType<typeof renderStart>
    await act(async () => { newDesign = renderStart() })

    expect(container.querySelector('input[type="search"]')).toBeNull()
    const library = container.querySelector('[data-start-library]')!
    expect(library.textContent).toContain('Recent Designs')
    expect(library.textContent).toContain('No Designs yet. The Designs you open or save appear here.')

    const start = Array.from(library.querySelectorAll('button')).find((button) => button.textContent === 'New Design')!
    await act(async () => { start.click() })
    expect(newDesign.run).toHaveBeenCalledOnce()
  })

  it('tells the Web edition its Designs are kept as Drafts in this browser', async () => {
    await act(async () => { renderStart({ recent: null }) })
    const library = container.querySelector('[data-start-library]')!
    expect(library.textContent).toContain('Drafts')
    expect(library.textContent).toContain('No Designs in this browser yet. Designs you start are kept here as Drafts.')
    expect(container.querySelector('input[type="search"]')).toBeNull()
  })

  it('shows neither the empty state nor the search while the lists load', async () => {
    await act(async () => { renderStart({ loading: true }) })
    const library = container.querySelector('[data-start-library]')!
    expect(library.textContent).toBe('')
  })

  it('keeps the search once there is something to search', async () => {
    await act(async () => {
      renderStart({ recent: [{ id: '/a.canopi', name: 'Orchard', updatedAt: new Date().toISOString(), open: vi.fn(), showInFolder: vi.fn(), remove: vi.fn() }] })
    })
    expect(container.querySelector('input[type="search"]')).not.toBeNull()
    expect(container.textContent).not.toContain('No Designs yet')
  })
})

describe('Desktop recent Designs', () => {
  afterEach(() => { recentDesigns.previews = null })

  it('shows the name only while the file has not been read', async () => {
    recentDesigns.files = [{ path: '/d/orchard.canopi', name: 'Orchard', updated_at: new Date().toISOString() }]
    await act(async () => { render(<WelcomeScreen />, container) })
    await act(async () => { await Promise.resolve() })

    const row = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Orchard'))
    expect(row).toBeDefined()
    expect(row!.textContent).not.toMatch(/plant/i)
    expect(row!.querySelector('[data-design-sketch]')).toBeNull()
    expect(container.textContent).not.toContain('No Designs yet')
  })

  it('shows counts and a sketch read from the file, and a quiet note for a file it cannot read', async () => {
    recentDesigns.files = [
      { path: '/d/orchard.canopi', name: 'Orchard', updated_at: new Date().toISOString() },
      { path: '/d/old.canopi', name: 'Old garden', updated_at: new Date().toISOString() },
      { path: '/d/huge.canopi', name: 'Huge estate', updated_at: new Date().toISOString() },
    ]
    recentDesigns.previews = async () => [
      {
        path: '/d/orchard.canopi',
        preview: {
          kind: 'read', plant_count: 2201, zone_count: 24,
          bounds: { west: 0.1, south: 47, east: 0.2, north: 47.05 },
          sketch: { width: 1000, height: 500, plants: [0, 500, 1000, 0], zones: [{ closed: true, points: [0, 0, 10, 0, 10, 10] }] },
        },
      },
      { path: '/d/old.canopi', preview: { kind: 'unreadable' } },
      { path: '/d/huge.canopi', preview: { kind: 'too_large' } },
    ]
    await act(async () => { render(<WelcomeScreen />, container) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const rowOf = (name: string) => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(name))!
    expect(rowOf('Orchard').textContent).toContain('2,201 plants · 24 zones')
    const sketch = rowOf('Orchard').querySelector('[data-design-sketch]')!
    expect(sketch.querySelectorAll('path')[1]!.getAttribute('d')).toBe('M0 500h0M1000 0h0')
    expect(rowOf('Old garden').textContent).toContain('Can’t read this file')
    expect(rowOf('Old garden').querySelector('[data-design-sketch]')).toBeNull()
    expect(rowOf('Huge estate').textContent).not.toMatch(/plant|read/i)
  })
})

describe('Plant database notice', () => {
  it('reserves its own row below the title bar so rails, dock and start screen move down', async () => {
    const host = document.createElement('div')
    container.appendChild(host)
    plantDbStatus.value = 'corrupt'
    await act(async () => { render(<DegradedBanner />, host) })

    const alert = host.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain("The plant catalog's database file is damaged")
    // The chrome below the title bar starts from --chrome-rail-top; the notice pushes it.
    expect(host.style.getPropertyValue('--chrome-rail-top')).toMatch(/^calc\(\d+px \+ var\(--space-2\)\)$/)

    await act(async () => { plantDbStatus.value = 'available' })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.style.getPropertyValue('--chrome-rail-top')).toBe('')
    render(null, host)
  })
})
