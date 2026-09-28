import { describe, expect, it, vi } from 'vitest'

const getSpeciesHabits = vi.hoisted(() => vi.fn(async (names: string[]) => (
  Object.fromEntries(names.map((name) => [name, 'Tree']))
)))
const getCommonNames = vi.hoisted(() => vi.fn(async (names: string[], locale: string) => (
  Object.fromEntries(names.map((name) => [name, `${name} (${locale})`]))
)))

vi.mock('../ipc/species', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ipc/species')>(),
  getCommonNames,
  getSpeciesHabits,
}))

describe('Desktop species catalog workbench', () => {
  it('reads catalog habits in batches the native lookup accepts', async () => {
    const { speciesCatalogWorkbench } = await import('../app/plant-browser/live.desktop')
    const names = Array.from({ length: 1201 }, (_, index) => `Species ${index}`)

    const habits = await speciesCatalogWorkbench.resolveHabits(names)

    expect(getSpeciesHabits.mock.calls.map(([batch]) => batch.length)).toEqual([500, 500, 201])
    expect(Object.keys(habits)).toHaveLength(1201)
  })

  it('reads common names in batches the native lookup accepts', async () => {
    const { speciesCatalogWorkbench } = await import('../app/plant-browser/live.desktop')
    const names = Array.from({ length: 701 }, (_, index) => `Species ${index}`)

    const common = await speciesCatalogWorkbench.resolveCommonNames(names, 'fr')

    expect(getCommonNames.mock.calls.map(([batch, locale]) => [batch.length, locale])).toEqual([[500, 'fr'], [201, 'fr']])
    expect(Object.keys(common)).toHaveLength(701)
    expect(common['Species 700']).toBe('Species 700 (fr)')
  })
})
