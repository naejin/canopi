export interface CurrencyEntry {
  code: string
  symbol: string
}

export const CURRENCIES: CurrencyEntry[] = [
  { code: 'EUR', symbol: '\u20AC' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '\u00A3' },
  { code: 'CHF', symbol: 'Fr' },
  { code: 'CAD', symbol: 'CA$' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'JPY', symbol: '\u00A5' },
  { code: 'CNY', symbol: '\u00A5' },
  { code: 'BRL', symbol: 'R$' },
  { code: 'INR', symbol: '\u20B9' },
  { code: 'MXN', symbol: 'MX$' },
  { code: 'SEK', symbol: 'kr' },
  { code: 'NZD', symbol: 'NZ$' },
]

export const CURRENCY_ITEMS = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} (${c.symbol})`,
}))
