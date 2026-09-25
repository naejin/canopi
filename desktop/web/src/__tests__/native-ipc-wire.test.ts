import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plantDbStatus } from '../app/health/state'
import { exportFile } from '../ipc/export'
import { searchSpecies } from '../ipc/species'
import type { SpeciesSearchRequest } from '../types/species'

const invoke = vi.hoisted(() => vi.fn(async (
  _command: string,
  _args?: Record<string, unknown>,
): Promise<unknown> => undefined))
const selectSavePath = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: selectSavePath }))

describe('native IPC wire format', () => {
  beforeEach(() => {
    invoke.mockClear()
    selectSavePath.mockReset()
  })

  it('sends species search as one request contract', async () => {
    plantDbStatus.value = 'available'
    const request: SpeciesSearchRequest = {
      text: 'malus',
      filters: {} as SpeciesSearchRequest['filters'],
      cursor: null,
      limit: 25,
      sort: 'Name',
      locale: 'en',
      include_total: false,
    }

    await searchSpecies(request)

    expect(invoke).toHaveBeenCalledWith('search_species', { request })
  })

  it('names text exports with the chosen format extension', async () => {
    selectSavePath.mockResolvedValueOnce('/exports/budget')
    await exportFile('a,b', 'budget.csv', 'CSV', ['csv'])
    expect(invoke).toHaveBeenLastCalledWith('export_file', { data: 'a,b', path: '/exports/budget.csv' })

    selectSavePath.mockResolvedValueOnce('/exports/Budget.CSV')
    await exportFile('a,b', 'budget.csv', 'CSV', ['csv'])
    expect(invoke).toHaveBeenLastCalledWith('export_file', { data: 'a,b', path: '/exports/Budget.CSV' })
  })
})
