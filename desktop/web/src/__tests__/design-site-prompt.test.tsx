import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ plant_db: 'ok' })),
  installSettingsProjection: vi.fn(() => ({ ready: Promise.resolve(), dispose: vi.fn() })),
  transport: vi.fn(async () => [] as unknown),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../shortcuts/manager', () => ({ initShortcuts: vi.fn(), disposeShortcuts: vi.fn() }))
vi.mock('../utils/theme', () => ({ initTheme: vi.fn(() => vi.fn()) }))
vi.mock('../app/settings/projection', () => ({ installSettingsProjection: mocks.installSettingsProjection }))
vi.mock('#geocoding-transport', () => ({ geocodingTransport: mocks.transport }))

import {
  answerDesignSite,
  pendingDesignSitePrompt,
  requestDesignSite,
} from '../app/document-session/design-site-prompt'
import {
  DesignSitePlacementCancelledError,
  registerDesignSiteResolver,
  resolveDesignLoadOutcome,
} from '../app/document-session/site-placement'
import { CanopiDesignNeedsSiteError } from '../app/contracts/canopi-design-errors'
import { placeSearch } from '../app/geocoding/place-search-session'
import { resetPlaceSearchPacingForTests } from '../app/geocoding/place-search'
import { bootstrapShell } from '../app/shell/bootstrap'
import { locale } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { createSessionPlane } from '../canvas/session-plane'
import { DesignSitePrompt } from '../components/canvas/DesignSitePrompt'
import type { CanopiFile, PendingDesignSite } from '../types/design'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { designSessionFixture } from './support/design-session-state'

const pending: PendingDesignSite = {
  from_version: 6,
  name: 'Verger du Mans',
  plant_count: 12,
  zone_count: 3,
  object_count: 17,
  width_m: 48.4,
  height_m: 31.6,
  document_json: '{}',
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

let container: HTMLDivElement

beforeEach(() => {
  locale.value = 'en'
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  answerDesignSite(null)
  registerDesignSiteResolver(null)
  render(null, container)
  container.remove()
  setCurrentCanvasSession(null)
  designSessionFixture.file = null
  placeSearch.clear()
  mocks.transport.mockReset()
  mocks.transport.mockImplementation(async () => [])
  resetPlaceSearchPacingForTests()
})

const dialog = () => container.querySelector<HTMLElement>('[data-design-site-prompt]')
const button = (text: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)!

describe('Where is your site? for a pre-geolocation Design', () => {
  it('names the Design, its counts and its extent, and Cancel declines', async () => {
    await act(async () => { render(<DesignSitePrompt />, container) })
    expect(dialog()).toBeNull()

    const answer = requestDesignSite(pending)
    await act(async () => { await flush() })
    const card = dialog()!
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.textContent).toContain('Where is your site?')
    expect(card.textContent).toContain('Verger du Mans')
    expect(card.textContent).toContain('12')
    expect(card.textContent).toContain('3')
    // Annotations and guides: everything that is not a plant or a zone.
    expect(card.textContent).toContain('2')
    expect(card.textContent).toContain('48 m × 32 m')
    expect(document.activeElement).toBe(card.querySelector('input[role="combobox"]'))

    await act(async () => { button('Cancel').click() })
    expect(await answer).toBeNull()
    expect(dialog()).toBeNull()
  })

  it('resolves to the picked place without moving the map', async () => {
    const showPlace = vi.fn(() => true)
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ viewport: { showPlace } }),
    }))
    mocks.transport.mockImplementation(async () => [
      { lat: '48.0061', lon: '0.1996', display_name: 'Le Mans, Sarthe, Pays de la Loire, France' },
    ])
    await act(async () => { render(<DesignSitePrompt />, container) })
    const answer = requestDesignSite(pending)
    await act(async () => { await flush() })

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!
    await act(async () => {
      input.focus()
      input.value = 'Le Mans'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await flush()
    })
    const option = container.querySelector<HTMLElement>('[role="option"]')!
    expect(option.textContent).toContain('Le Mans')
    await act(async () => { option.click(); await flush() })

    expect(await answer).toEqual({ lon: 0.1996, lat: 48.0061 })
    expect(showPlace).not.toHaveBeenCalled()
  })

  it('offers the map centre while a map is on screen, and Escape cancels', async () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    designSessionFixture.file = openDesignFile()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({ sessionPlane: plane, viewport: { x: 200, y: 150, scale: 1 } }),
    }))
    await act(async () => { render(<DesignSitePrompt />, container) })
    const first = requestDesignSite(pending)
    await act(async () => { await flush() })

    await act(async () => { button('Place at the map centre').click() })
    const site = await first
    expect(site?.lon).toBeCloseTo(2.35, 6)
    expect(site?.lat).toBeCloseTo(48.85, 6)

    const second = requestDesignSite(pending)
    await act(async () => { await flush() })
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(await second).toBeNull()
  })

  it('hides the map-centre action without a map', async () => {
    await act(async () => { render(<DesignSitePrompt />, container) })
    void requestDesignSite(pending)
    await act(async () => { await flush() })
    expect(Array.from(container.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Cancel'])
  })

  it('hides the map-centre action on the Start screen, where the canvas session lingers without a Design', async () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({ sessionPlane: plane, viewport: { x: 200, y: 150, scale: 1 } }),
    }))
    await act(async () => { render(<DesignSitePrompt />, container) })
    void requestDesignSite(pending)
    await act(async () => { await flush() })
    expect(Array.from(container.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Cancel'])
  })

  it('a newer request cancels an older one', async () => {
    const first = requestDesignSite(pending)
    const second = requestDesignSite({ ...pending, name: 'Second' })
    expect(await first).toBeNull()
    expect(pendingDesignSitePrompt.value?.name).toBe('Second')
    answerDesignSite({ lon: 1, lat: 2 })
    expect(await second).toEqual({ lon: 1, lat: 2 })
    expect(pendingDesignSitePrompt.value).toBeNull()
  })
})

describe('Desktop shell registers the site prompt', () => {
  it('routes a needs_site outcome to the prompt, and Cancel cancels the transition', async () => {
    const placeAtSite = vi.fn()
    const outcome = { kind: 'needs_site' as const, pending, fingerprint: 'fp' }
    await expect(resolveDesignLoadOutcome(outcome, '/a.canopi', placeAtSite)).rejects.toBeInstanceOf(CanopiDesignNeedsSiteError)

    const shell = bootstrapShell({ load: vi.fn(), save: vi.fn() } as never)
    await shell.ready
    const resolving = resolveDesignLoadOutcome(outcome, '/a.canopi', placeAtSite)
    await flush()
    expect(pendingDesignSitePrompt.value?.name).toBe('Verger du Mans')
    answerDesignSite(null)
    await expect(resolving).rejects.toBeInstanceOf(DesignSitePlacementCancelledError)
    expect(placeAtSite).not.toHaveBeenCalled()

    shell.dispose()
    await expect(resolveDesignLoadOutcome(outcome, '/a.canopi', placeAtSite)).rejects.toBeInstanceOf(CanopiDesignNeedsSiteError)
  })
})

function openDesignFile(): CanopiFile {
  return {
    version: 9,
    name: 'Orchard',
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  } as unknown as CanopiFile
}
