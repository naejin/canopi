import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addCivilDays,
  addCivilMonths,
  buildCivilMonthGrid,
  civilDateToLocalDate,
  formatCivilDate,
  civilWeekStartDay,
  parseCivilDate,
  startOfCivilWeek,
} from '../app/timeline/civil-date'

describe('calendar civil dates', () => {
  it('parses strict dates and crosses leap-day and year boundaries', () => {
    expect(parseCivilDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(parseCivilDate('2023-02-29')).toBeNull()
    expect(parseCivilDate('2026-2-01')).toBeNull()
    expect(formatCivilDate(addCivilDays({ year: 2024, month: 2, day: 28 }, 1))).toBe('2024-02-29')
    expect(formatCivilDate(addCivilDays({ year: 2026, month: 12, day: 31 }, 1))).toBe('2027-01-01')
    expect(formatCivilDate(addCivilMonths({ year: 2026, month: 1, day: 31 }, 1))).toBe('2026-02-28')
  })

  it('uses locale week starts and emits actual five or six week months', () => {
    const date = { year: 2026, month: 9, day: 9 }
    expect(formatCivilDate(startOfCivilWeek(date, 'en'))).toBe('2026-09-06')
    expect(formatCivilDate(startOfCivilWeek(date, 'fr'))).toBe('2026-09-07')
    expect(buildCivilMonthGrid({ year: 2026, month: 2, day: 1 }, 'en')).toHaveLength(4)
    expect(buildCivilMonthGrid({ year: 2026, month: 8, day: 1 }, 'fr')).toHaveLength(6)
  })

  it('follows the locale week start from Intl week info', () => {
    // 2026-09-09 is a Wednesday: Monday is the 7th, Sunday the 6th.
    const date = { year: 2026, month: 9, day: 9 }
    for (const tag of ['fr', 'de', 'es', 'it', 'nl', 'ru', 'zh', 'en-GB']) {
      expect(formatCivilDate(startOfCivilWeek(date, tag)), tag).toBe('2026-09-07')
    }
    for (const tag of ['en', 'en-US', 'pt', 'ja', 'ko']) {
      expect(formatCivilDate(startOfCivilWeek(date, tag)), tag).toBe('2026-09-06')
    }
  })

  describe('without Intl week info (older WebKit)', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('falls back to a table for the app locales', () => {
      class LocaleWithoutWeekInfo { constructor(readonly baseName: string) {} }
      vi.stubGlobal('Intl', { ...Intl, Locale: LocaleWithoutWeekInfo })
      for (const tag of ['fr', 'de', 'es', 'it', 'nl', 'ru', 'zh']) {
        expect(civilWeekStartDay(tag), tag).toBe(1)
      }
      for (const tag of ['en', 'en-US', 'pt', 'ja', 'ko']) expect(civilWeekStartDay(tag), tag).toBe(0)
      expect(civilWeekStartDay('en-GB')).toBe(1)
      expect(civilWeekStartDay('xx')).toBe(1)
    })
  })

  it('uses calendar constructors through both DST transitions without shifting the day', () => {
    for (const [date, expected] of [
      [{ year: 2026, month: 3, day: 28 }, '2026-03-29'],
      [{ year: 2026, month: 10, day: 24 }, '2026-10-25'],
    ] as const) {
      const next = addCivilDays(date, 1)
      expect(formatCivilDate(next)).toBe(expected)
      expect(civilDateToLocalDate(next).getHours()).toBe(0)
    }
  })
})
