import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HTML_ENTRIES = [
  ['Desktop', '../../index.html'],
  ['Web', '../../web.html'],
] as const

describe('first-paint theme bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(HTML_ENTRIES)(
    'applies valid cached themes before the %s module entry',
    (_edition, entryPath) => {
      const entry = readEntryBootstrap(entryPath)

      expect(entry.bootstrapIndex).toBeGreaterThanOrEqual(0)
      expect(entry.moduleEntryIndex).toBeGreaterThan(entry.bootstrapIndex)
      for (const cachedTheme of ['light', 'dark'] as const) {
        document.documentElement.removeAttribute('data-theme')
        localStorage.setItem('canopi-theme', cachedTheme)
        executeBootstrap(entry.code)
        expect(document.documentElement.getAttribute('data-theme')).toBe(cachedTheme)
      }
    },
  )

  it.each(HTML_ENTRIES)(
    'ignores an invalid cached theme in the %s entry',
    (_edition, entryPath) => {
      localStorage.setItem('canopi-theme', 'sepia')

      executeBootstrap(readEntryBootstrap(entryPath).code)

      expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    },
  )

  it.each(HTML_ENTRIES)(
    'continues parsing the %s entry when theme cache access is denied',
    (_edition, entryPath) => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage denied')
      })

      expect(() => executeBootstrap(readEntryBootstrap(entryPath).code)).not.toThrow()
    },
  )
})

function readEntryBootstrap(entryPath: string): {
  readonly bootstrapIndex: number
  readonly code: string
  readonly moduleEntryIndex: number
} {
  const source = readFileSync(new URL(entryPath, import.meta.url), 'utf8')
  const entryDocument = new DOMParser().parseFromString(source, 'text/html')
  const scripts = Array.from(entryDocument.scripts)
  const bootstrapIndex = scripts.findIndex((script) => (
    script.textContent?.includes('canopi-theme') ?? false
  ))
  return {
    bootstrapIndex,
    code: scripts[bootstrapIndex]?.textContent ?? '',
    moduleEntryIndex: scripts.findIndex((script) => script.type === 'module'),
  }
}

function executeBootstrap(code: string): void {
  Function(code)()
}
