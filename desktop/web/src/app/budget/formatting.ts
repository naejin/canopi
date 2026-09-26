const _formatterCache = new Map<string, Intl.NumberFormat>()

export function formatBudgetCurrency(amount: number, currency: string, locale?: string): string {
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

const _inputFormatterCache = new Map<string, Intl.NumberFormat>()

/** A unit cost as the price field shows it: locale decimals, no symbol, no grouping. */
export function formatBudgetPriceInput(amount: number, locale: string): string {
  let formatter = _inputFormatterCache.get(locale)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    })
    _inputFormatterCache.set(locale, formatter)
  }
  return formatter.format(amount)
}

/**
 * Reads a typed unit cost: locale decimals ("3,90") or a dot, spaces ignored.
 * Returns null for anything that is not a finite, nonnegative number.
 */
export function parseBudgetPriceInput(value: string, locale: string): number | null {
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.'
  let text = value.replace(/[\s\u00a0\u202f]/g, '')
  if (decimal !== '.') text = text.replace(decimal, '.')
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** The currency's symbol in this locale ("€", "$", "CHF"), shown inside price fields. */
export function budgetCurrencySymbol(currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

export function escapeBudgetCsvField(value: string): string {
  const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
    return `"${sanitized.replace(/"/g, '""')}"`
  }
  return sanitized
}
