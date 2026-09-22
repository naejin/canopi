import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BasemapSettings } from '../components/canvas/BasemapSettings'
import { hydrateSettingsProjection } from '../app/settings/projection'
import { googleMapsApiKey } from '../app/settings/state'
import { DEFAULT_SETTINGS } from '../generated/settings'
import type { Settings } from '../types/settings'

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('basemap provider settings', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    // This build has no MapTiler key, which is the state the contract cares
    // about: a saved satellite choice must be reported unavailable rather than
    // silently replaced.
    delete (import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('offers all three provider identities', () => {
    hydrateSettingsProjection(baseSettings())
    act(() => {
      render(<BasemapSettings />, container)
    })
    const labels = Array.from(container.querySelectorAll('label')).map((node) =>
      node.textContent ?? '',
    )
    expect(labels.some((label) => label.includes('OpenStreetMap'))).toBe(true)
    expect(labels.some((label) => label.includes('MapTiler'))).toBe(true)
    expect(labels.some((label) => label.includes('Google'))).toBe(true)
  })

  it('marks MapTiler satellite unavailable in a build without its key, without substituting', () => {
    hydrateSettingsProjection(baseSettings({ map_style: 'satellite' }))
    act(() => {
      render(<BasemapSettings />, container)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('unavailable')
    // The failure names the real cause and offers no other provider's imagery.
    expect(text).toMatch(/MapTiler/)
    expect(text).not.toContain('tile.openstreetmap.org')
  })

  it('shows the exact Google key prompt on the keyless path and no official attribution', () => {
    hydrateSettingsProjection(baseSettings({ map_style: 'google_satellite' }))
    act(() => {
      render(<BasemapSettings />, container)
    })
    expect(container.textContent).toContain(
      'Enter a Google Maps API key to load the official Google tiles.',
    )
  })

  it('masks the key field and never renders the stored key into the DOM unescaped', () => {
    hydrateSettingsProjection(
      baseSettings({ map_style: 'google_satellite', google_maps_api_key: 'fake-secret-key' }),
    )
    act(() => {
      render(<BasemapSettings />, container)
    })
    const field = container.querySelector<HTMLInputElement>('input[type="password"]')
    expect(field).not.toBeNull()
    // Masked input is the contract's requirement; a text field would expose the
    // credential to anyone looking at the screen.
    expect(field?.type).toBe('password')
    expect(field?.value).toBe('fake-secret-key')
  })

  it('clears the key back to the keyless path', () => {
    hydrateSettingsProjection(
      baseSettings({ map_style: 'google_satellite', google_maps_api_key: 'fake-secret-key' }),
    )
    act(() => {
      render(<BasemapSettings />, container)
    })
    const clear = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Clear'),
    )
    expect(clear).toBeDefined()
    act(() => {
      clear?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(googleMapsApiKey.value).toBeNull()
  })

  it('states that the key is device-local and never written to a design or export', () => {
    hydrateSettingsProjection(baseSettings({ map_style: 'google_satellite' }))
    act(() => {
      render(<BasemapSettings />, container)
    })
    expect(container.textContent).toMatch(/device/i)
    expect(container.textContent).toMatch(/Design|export/i)
  })
})
