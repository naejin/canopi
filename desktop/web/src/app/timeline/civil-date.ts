export interface CivilDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const SUNDAY_START_LOCALES = new Set(['en', 'pt', 'zh', 'ja', 'ko'])

export function parseCivilDate(value: string | null | undefined): CivilDate | null {
  if (!value) return null
  const match = CIVIL_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const local = new Date(year, month - 1, day)
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
  ) return null
  return { year, month, day }
}

export function formatCivilDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

export function civilDateToLocalDate(date: CivilDate): Date {
  return new Date(date.year, date.month - 1, date.day)
}

export function localToday(now = new Date()): CivilDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  }
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const local = new Date(date.year, date.month - 1, date.day + days)
  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
  }
}

export function addCivilMonths(date: CivilDate, months: number): CivilDate {
  const local = new Date(date.year, date.month - 1 + months, 1)
  const lastDay = new Date(local.getFullYear(), local.getMonth() + 1, 0).getDate()
  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: Math.min(date.day, lastDay),
  }
}

export function compareCivilDates(left: CivilDate, right: CivilDate): number {
  return formatCivilDate(left).localeCompare(formatCivilDate(right))
}

export function startOfCivilMonth(date: CivilDate): CivilDate {
  return { year: date.year, month: date.month, day: 1 }
}

export function endOfCivilMonth(date: CivilDate): CivilDate {
  return {
    year: date.year,
    month: date.month,
    day: new Date(date.year, date.month, 0).getDate(),
  }
}

export function civilWeekStartsOnSunday(locale: string): boolean {
  return SUNDAY_START_LOCALES.has(locale.split('-')[0] ?? locale)
}

export function startOfCivilWeek(date: CivilDate, locale: string): CivilDate {
  const weekday = civilDateToLocalDate(date).getDay()
  const offset = civilWeekStartsOnSunday(locale) ? weekday : (weekday + 6) % 7
  return addCivilDays(date, -offset)
}

export function buildCivilMonthGrid(month: CivilDate, locale: string): CivilDate[][] {
  const start = startOfCivilWeek(startOfCivilMonth(month), locale)
  const end = endOfCivilMonth(month)
  const weeks: CivilDate[][] = []
  let cursor = start
  do {
    const week = Array.from({ length: 7 }, (_, index) => addCivilDays(cursor, index))
    weeks.push(week)
    cursor = addCivilDays(cursor, 7)
  } while (compareCivilDates(cursor, end) <= 0)
  return weeks
}

export function civilDateInRange(
  date: CivilDate,
  start: CivilDate,
  end: CivilDate,
): boolean {
  return compareCivilDates(date, start) >= 0 && compareCivilDates(date, end) <= 0
}
