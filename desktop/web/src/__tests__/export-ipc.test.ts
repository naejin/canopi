import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: mocks.save,
}))

import { exportFile } from '../ipc/export'

describe('text export IPC', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.save.mockReset()
  })

  it('writes the selected destination through the focused export command', async () => {
    mocks.save.mockResolvedValue('/tmp/orchard-budget.csv')
    mocks.invoke.mockResolvedValue('/tmp/orchard-budget.csv')

    await expect(
      exportFile('Species,Quantity', 'orchard-budget.csv', 'CSV', ['csv']),
    ).resolves.toBe('/tmp/orchard-budget.csv')

    expect(mocks.save).toHaveBeenCalledWith({
      defaultPath: 'orchard-budget.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    expect(mocks.invoke).toHaveBeenCalledWith('export_file', {
      data: 'Species,Quantity',
      path: '/tmp/orchard-budget.csv',
    })
  })

  it('does not invoke the native command when the dialog is cancelled', async () => {
    mocks.save.mockResolvedValue(null)

    await expect(exportFile('data', 'budget.csv', 'CSV', ['csv'])).rejects.toThrow(
      'Dialog cancelled',
    )
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
