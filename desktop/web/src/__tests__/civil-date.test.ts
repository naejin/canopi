import { describe, expect, it } from 'vitest'
import {
  addCivilDays,
  addCivilMonths,
  buildCivilMonthGrid,
  civilDateToLocalDate,
  formatCivilDate,
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
