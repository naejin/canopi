import { describe, expect, it } from 'vitest'
import { createLibraryReference } from '../../ui-gallery/library-reference/model'

describe('library reference behavior', () => {
  it('publishes one item for a multi-file import without attaching into a switched Design', () => {
    const model = createLibraryReference('empty')
    const id = model.importFiles('Site terrain', ['west.tif', 'east.tif'])!
    expect(model.items.value).toHaveLength(1)
    expect(model.items.value[0]?.status).toBe('importing')
    model.switchDesign('meadow')
    model.finishImport(id)
    expect(model.items.value[0]).toMatchObject({ name: 'Site terrain', status: 'ready', files: ['west.tif', 'east.tif'] })
    expect(model.layers.value.orchard).toEqual([])
    expect(model.layers.value.meadow).toEqual([])
  })

  it('reuses one item in two Designs and keeps Add idempotent after hiding', () => {
    const model = createLibraryReference('ready')
    model.add('terrain')
    model.setVisible('terrain', false)
    model.add('terrain')
    expect(model.layers.value.orchard).toEqual([{ id: 'terrain', visible: false, opacity: 75 }])
    model.switchDesign('meadow')
    model.add('terrain')
    model.remove('terrain')
    expect(model.layers.value.meadow).toEqual([])
    expect(model.layers.value.orchard).toHaveLength(1)
    expect(model.items.value.find(item => item.id === 'terrain')).toBeDefined()
  })

  it('cancel and dismiss prevent a late completion from reviving an import', () => {
    const model = createLibraryReference('empty')
    const id = model.importFiles('Cancelled terrain', ['tile.tif'])!
    model.cancel(id)
    model.finishImport(id)
    expect(model.items.value[0]?.status).toBe('cancelled')
    model.deleteItem(id)
    model.finishImport(id)
    expect(model.items.value).toEqual([])
  })

  it('retries a failed item once and keeps its files and identity', () => {
    const model = createLibraryReference('empty')
    const id = model.importFiles('Site', ['a.tif', 'b.tif'])!
    model.finishImport(id, true)
    model.retry(id)
    model.finishImport(id)
    model.finishImport(id)
    expect(model.items.value).toHaveLength(1)
    expect(model.items.value[0]).toMatchObject({ id, status: 'ready', files: ['a.tif', 'b.tif'] })
  })

  it('refuses dependent-source deletion and retains unavailable references in other Designs', () => {
    const model = createLibraryReference('ready')
    expect(model.deleteItem('north')).toBe(false)
    model.add('terrain')
    model.switchDesign('meadow')
    expect(model.deleteItem('terrain')).toBe(true)
    expect(model.layers.value.orchard[0]?.id).toBe('terrain')
    expect(model.items.value.some(item => item.id === 'terrain')).toBe(false)
  })

  it('ends inspection on hiding, removal and Design replacement', () => {
    const model = createLibraryReference('ready')
    model.add('terrain')
    model.inspect('terrain')
    model.setVisible('terrain', false)
    expect(model.inspection.value).toBeNull()
    model.setVisible('terrain', true)
    model.inspect('terrain')
    model.switchDesign('meadow')
    expect(model.inspection.value).toBeNull()
    model.add('terrain')
    model.inspect('terrain')
    model.remove('terrain')
    expect(model.inspection.value).toBeNull()
  })
})
