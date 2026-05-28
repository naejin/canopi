const _formatterCache = new Map<string, Intl.NumberFormat>()

export function formatCurrency(amount: number, currency: string, locale?: string): string {
  try {
    const key = locale ? `${locale}:${currency}` : currency
    let formatter = _formatterCache.get(key)
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      _formatterCache.set(key, formatter)
    }
    return formatter.format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function escapeCsvField(value: string): string {
  // Prevent spreadsheet formula injection (OWASP CSV injection)
  const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
    return `"${sanitized.replace(/"/g, '""')}"`
  }
  return sanitized
}
