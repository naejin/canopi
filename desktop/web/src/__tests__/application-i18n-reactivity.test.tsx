import i18n from 'i18next'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { plantDbStatus } from '../app/health/state'
import { locale } from '../app/settings/state'
import { DegradedBanner } from '../components/shared/DegradedBanner'
import { t } from '../i18n'

describe('application translation authority', () => {
  let container: HTMLDivElement

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    locale.value = 'en'
    await i18n.changeLanguage('en')
    plantDbStatus.value = 'missing'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    plantDbStatus.value = 'available'
    locale.value = 'en'
    vi.restoreAllMocks()
  })

  it('rerenders mounted degraded chrome when only the locale changes', async () => {
    await act(async () => {
      render(<DegradedBanner />, container)
    })

    expect(container.textContent).toContain('Plant database not found')

    await act(async () => {
      locale.value = 'fr'
    })

    expect(container.textContent).toContain('Base de données végétale introuvable')
  })

  it('pins interpolation, count, and fallback reads to the observed locale synchronously', () => {
    const pendingLanguageChange = new Promise<never>(() => {})
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage')
      .mockImplementation(() => pendingLanguageChange)

    locale.value = 'fr'

    expect(changeLanguage).toHaveBeenCalledWith('fr')
    expect(t('plantDb.placeSpecies', { name: 'Poirier' })).toBe('Placer Poirier')
    expect(t('worldMap.plantCount', { count: 4 })).toBe('4 plantes')
    expect(t('missing.test.key', 'Fallback label')).toBe('Fallback label')
  })
})
