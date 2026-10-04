import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Messages = { readonly [key: string]: string | Messages }

const LOCALES = readdirSync('src/i18n').filter((file) => file.endsWith('.json'))

function strings(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => typeof value === 'string'
    ? [[`${prefix}${key}`, value] as [string, string]]
    : strings(value, `${prefix}${key}.`))
}

function load(file: string): Messages {
  return JSON.parse(readFileSync(`src/i18n/${file}`, 'utf8')) as Messages
}

describe('the plant catalog is named one way', () => {
  it('has no retired "Plant Database" label in any language', () => {
    for (const file of LOCALES) {
      const keys = strings(load(file)).map(([key]) => key)
      expect(keys, file).not.toContain('nav.plantDb')
    }
    const english = strings(load('en.json'))
    expect(english.filter(([, text]) => /plant database|plant db\b/i.test(text))).toEqual([])
  })

  it('names the catalog, what is safe and the next step when its database file is unavailable', () => {
    const english = Object.fromEntries(strings(load('en.json')))
    expect(english['health.plantDbMissing']).toBe(
      "The plant catalog's database file is missing, so plant search and details are unavailable. Your Designs are safe. Reinstall Canopi to restore it.",
    )
    expect(english['health.plantDbCorrupt']).toBe(
      "The plant catalog's database file is damaged, so plant search and details are unavailable. Your Designs are safe. Reinstall Canopi to restore it.",
    )
    for (const file of LOCALES) {
      const messages = Object.fromEntries(strings(load(file)))
      // Developer instructions stay out of the notice.
      expect(messages['health.plantDbMissing'], file).not.toContain('prepare-db.py')
      expect(messages['health.plantDbCorrupt'], file).not.toContain('prepare-db.py')
    }
  })
})
