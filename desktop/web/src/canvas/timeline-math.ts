// ---------------------------------------------------------------------------
// Timeline math — time-to-pixel conversion, date interval calculation
// ---------------------------------------------------------------------------

/** Nice date intervals (in days) for adaptive time ruler density */
const NICE_INTERVALS_DAYS = [1, 7, 14, 30, 91, 182, 365]

/**
 * Pick a nice date interval (in days) so tick marks are ~80-150px apart.
 */
export function niceInterval(pxPerDay: number): number {
  const minGap = 80 // min pixels between labels
  for (const interval of NICE_INTERVALS_DAYS) {
    if (interval * pxPerDay >= minGap) return interval
  }
  return 365
}

/**
 * Format a date for the time ruler label, adapting to the current interval.
 */
export function formatDateLabel(date: Date, intervalDays: number): string {
  if (intervalDays <= 1) {
    return `${date.getDate()} ${MONTH_ABBRS[date.getMonth()]}`
  }
  if (intervalDays <= 30) {
    return `${date.getDate()} ${MONTH_ABBRS[date.getMonth()]}`
  }
  if (intervalDays <= 182) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`
  }
  return `${date.getFullYear()}`
}

const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Convert a Date to a pixel x-coordinate on the timeline.
 */
export function dateToX(date: Date, originDate: Date, pxPerDay: number): number {
  const diffMs = date.getTime() - originDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays * pxPerDay
}

/**
 * Convert a pixel x-coordinate to a Date.
 */
export function xToDate(x: number, originDate: Date, pxPerDay: number): Date {
  const diffDays = x / pxPerDay
  return new Date(originDate.getTime() + diffDays * 1000 * 60 * 60 * 24)
}

/** Snap a date to the nearest day boundary. */
export function snapToDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Format a Date as ISO 8601 date string (YYYY-MM-DD). */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
