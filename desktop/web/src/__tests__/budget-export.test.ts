import { describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/design', () => ({
  exportFile: vi.fn().mockResolvedValue(undefined),
}))

import { exportFile } from '../ipc/design'
import { exportBudgetCsv } from '../app/budget/export'

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
})
