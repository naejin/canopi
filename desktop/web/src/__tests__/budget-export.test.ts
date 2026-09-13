import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/export', () => ({
  exportFile: vi.fn().mockResolvedValue(undefined),
}))

import { exportFile } from '../ipc/export'
import { exportBudgetCsv } from '../app/budget/export'
import { deliverBudgetCsv as deliverBrowserBudgetCsv } from '../app/budget/platform.browser'

afterEach(() => vi.restoreAllMocks())

describe('budget export', () => {
  it('exports the expected csv filename and row content through the app boundary', async () => {
    await exportBudgetCsv(
      [{ canonical: 'Malus domestica', commonName: 'Apple', count: 3 }],
      {
        currency: 'EUR',
        designName: 'orchard',
        lineItemPriceMap: new Map([['Malus domestica', { unit_cost: 12.5, currency: 'EUR' }]]),
        grandTotal: 37.5,
      },
    )

    expect(vi.mocked(exportFile)).toHaveBeenCalledWith(
      expect.stringContaining('Apple,3,12.50,37.50,EUR'),
      'orchard-budget.csv',
      'CSV',
      ['csv'],
    )
  })

  it('keeps unavailable prices distinct from explicit zero prices', async () => {
    await exportBudgetCsv(
      [
        { canonical: 'Malus domestica', commonName: 'Apple', count: 3 },
        { canonical: 'Pyrus communis', commonName: 'Pear', count: 2 },
      ],
      {
        currency: 'EUR',
        designName: 'orchard',
        lineItemPriceMap: new Map([['Malus domestica', { unit_cost: 0, currency: 'EUR' }]]),
        grandTotal: 0,
      },
    )

    const csv = vi.mocked(exportFile).mock.calls.at(-1)?.[0]
    expect(csv).toContain('Apple,3,0.00,0.00,EUR')
    expect(csv).toContain('Pear,2,,,EUR')
  })

  it('downloads the shared CSV through the browser delivery adapter', async () => {
    let observed: HTMLAnchorElement | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      observed = this
    })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:budget')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await deliverBrowserBudgetCsv('Species,Quantity\nApple,3', 'orchard-budget.csv')

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(observed?.download).toBe('orchard-budget.csv')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:budget')
    expect(document.querySelector('a[download="orchard-budget.csv"]')).toBeNull()
  })
})
