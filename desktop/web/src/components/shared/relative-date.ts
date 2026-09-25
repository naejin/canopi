/** A short "today / 3 days ago" label for the last week, else a locale date. */
export function formatRelativeDate(iso: string, lang: string, now = new Date()): string {
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 7) {
      return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-diffDays, 'day')
    }
    return date.toLocaleDateString(lang)
  } catch {
    return ''
  }
}
