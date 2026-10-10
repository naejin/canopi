/**
 * When a Design last changed, as the start screen shows it: "Today, 2:05 PM",
 * "Yesterday, 6:20 PM", then "Sep 12" (with the year once it is not this year).
 */
export function formatRelativeDate(iso: string, lang: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / (1000 * 60 * 60 * 24))
  if (dayDelta === 0 || dayDelta === 1) {
    const day = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-dayDelta, 'day')
    const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(date)
    return `${capitalize(day, lang)}, ${time}`
  }
  return new Intl.DateTimeFormat(lang, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date)
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function capitalize(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1)
}
