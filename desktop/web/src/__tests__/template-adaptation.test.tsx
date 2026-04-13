import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateAdaptation } from '../components/canvas/TemplateAdaptation'
import { locale } from '../app/settings/state'

const mocks = vi.hoisted(() => ({
  checkPlantCompatibility: vi.fn(),
  suggestReplacements: vi.fn(),
}))

vi.mock('../ipc/adaptation', () => ({
  checkPlantCompatibility: mocks.checkPlantCompatibility,
  suggestReplacements: mocks.suggestReplacements,
}))

describe('TemplateAdaptation', () => {
  let container: HTMLDivElement

  async function flushEffects() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    mocks.checkPlantCompatibility.mockReset()
    mocks.suggestReplacements.mockReset()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('shows an explicit error when compatibility loading fails', async () => {
    mocks.checkPlantCompatibility.mockRejectedValueOnce(
      new Error('Plant database unavailable: bundled plant database is missing'),
    )

    await act(async () => {
      render(
        <TemplateAdaptation
          canonicalNames={['Malus domestica']}
          targetHardiness={7}
          onClose={() => {}}
        />,
        container,
      )
    })

    await act(async () => {
      await flushEffects()
    })

    const errorAlert = container.querySelector('[role="alert"]')
    expect(errorAlert).not.toBeNull()
    expect(errorAlert?.textContent ?? '').toContain('Plant database')
    expect(container.textContent).not.toContain('0/0')
  })

  it('shows an explicit error when replacement suggestions fail', async () => {
    mocks.checkPlantCompatibility.mockResolvedValueOnce([
      {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        hardiness_min: 3,
        hardiness_max: 5,
        is_compatible: false,
        zone_diff: 2,
      },
    ])
    mocks.suggestReplacements.mockRejectedValueOnce(
      new Error('Plant database unavailable: bundled plant database is corrupt'),
    )

    await act(async () => {
      render(
        <TemplateAdaptation
          canonicalNames={['Malus domestica']}
          targetHardiness={7}
          onClose={() => {}}
        />,
        container,
      )
    })

    await act(async () => {
      await flushEffects()
    })

    const suggestButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.toLowerCase().includes('suggest'),
    )
    expect(suggestButton).not.toBeUndefined()

    await act(async () => {
      suggestButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const errorAlert = container.querySelector('[role="alert"]')
    expect(errorAlert).not.toBeNull()
    expect(errorAlert?.textContent ?? '').toContain('Plant database unavailable')
  })

  it('reloads compatibility when the locale changes while the modal is open', async () => {
    mocks.checkPlantCompatibility.mockResolvedValue([])

    await act(async () => {
      render(
        <TemplateAdaptation
          canonicalNames={['Malus domestica']}
          targetHardiness={7}
          onClose={() => {}}
        />,
        container,
      )
      await flushEffects()
    })

    locale.value = 'fr'

    await act(async () => {
      await flushEffects()
    })

    expect(mocks.checkPlantCompatibility).toHaveBeenNthCalledWith(1, ['Malus domestica'], 7, 'en')
    expect(mocks.checkPlantCompatibility).toHaveBeenNthCalledWith(2, ['Malus domestica'], 7, 'fr')
  })
})
