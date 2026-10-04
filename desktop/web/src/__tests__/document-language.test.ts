import { afterEach, describe, expect, it } from 'vitest'
import { locale } from '../app/settings/state'
import { initTheme } from '../utils/theme'

describe('document language', () => {
  let dispose: (() => void) | null = null
  afterEach(() => {
    dispose?.()
    locale.value = 'en'
  })

  it('follows the UI locale so CJK type sizes and screen readers apply', () => {
    dispose = initTheme()
    expect(document.documentElement.lang).toBe('en')
    locale.value = 'fr'
    expect(document.documentElement.lang).toBe('fr')
    locale.value = 'ja'
    expect(document.documentElement.lang).toBe('ja')
  })
})
