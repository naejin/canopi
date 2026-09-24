import { signal } from '@preact/signals'

export type DesignId = 'orchard' | 'meadow'
export type ItemStatus = 'ready' | 'importing' | 'failed' | 'cancelled' | 'unavailable'
export interface LibraryItem {
  id: string
  name: string
  kind: 'Elevation' | 'Slope'
  files: string[]
  status: ItemStatus
  inputId?: string
}
export interface LayerReference { id: string; visible: boolean; opacity: number }
export const scenarios = ['ready', 'empty', 'importing', 'failed', 'unavailable', 'long'] as const
export type Scenario = typeof scenarios[number]
export const designNames: Record<DesignId, string> = { orchard: 'Orchard garden', meadow: 'Meadow garden' }

/** Memory-only UX fixture. No files, native jobs, persistence or scientific computation. */
export function createLibraryReference(scenario: string = 'ready') {
  const seed: LibraryItem[] = [
    { id: 'terrain', name: 'Orchard terrain', kind: 'Elevation', files: ['orchard-west.tif', 'orchard-east.tif'], status: 'ready' },
    { id: 'north', name: 'North field terrain', kind: 'Elevation', files: ['north-field.tif'], status: 'ready' },
    { id: 'slope', name: 'North field slope', kind: 'Slope', files: ['north-field-slope.tif'], status: 'ready', inputId: 'north' },
  ]
  const first = seed[0]
  if (first) {
    if (scenario === 'long') first.name = 'Orchard terrain — upper terraces, woodland edge and the eastern pasture'
    if (scenario === 'unavailable') first.status = 'unavailable'
    if (scenario === 'importing' || scenario === 'failed') first.status = scenario
  }
  const items = signal<LibraryItem[]>(scenario === 'empty' ? [] : seed)
  const layers = signal<Record<DesignId, LayerReference[]>>({ orchard: [], meadow: [] })
  if (scenario === 'unavailable') layers.value.orchard = [{ id: 'terrain', visible: true, opacity: 75 }]
  const activeDesign = signal<DesignId>('orchard')
  const inspection = signal<string | null>(null)
  const message = signal('Library ready. Add data to either sample Design.')
  let nextId = 1
  const patchItem = (id: string, patch: Partial<LibraryItem>) => {
    items.value = items.value.map(item => item.id === id ? { ...item, ...patch } : item)
  }
  const updateLayers = (update: (current: LayerReference[]) => LayerReference[]) => {
    layers.value = { ...layers.value, [activeDesign.value]: update(layers.value[activeDesign.value]) }
  }
  return {
    items, layers, activeDesign, inspection, message,
    importFiles(name: string, files: string[]): string | null {
      if (!name.trim() || !files.length || items.value.some(item => item.status === 'importing')) return null
      const id = `import-${nextId++}`
      items.value = [...items.value, { id, name: name.trim(), files: [...files], kind: 'Elevation', status: 'importing' }]
      message.value = `Importing ${files.length} files as one library item.`
      return id
    },
    finishImport(id: string, fail = false) {
      if (items.value.find(item => item.id === id)?.status !== 'importing') return
      patchItem(id, { status: fail ? 'failed' : 'ready' })
      message.value = fail ? 'Import failed. No partial item is ready; Retry keeps the selected files.' : 'Import complete. The item is ready in your library.'
    },
    cancel(id: string) {
      if (items.value.find(item => item.id === id)?.status !== 'importing') return
      patchItem(id, { status: 'cancelled' })
      message.value = 'Import cancelled. No data was added to a Design.'
    },
    retry(id: string) {
      const item = items.value.find(item => item.id === id)
      if (!item || !['failed', 'cancelled'].includes(item.status) || items.value.some(row => row.status === 'importing')) return
      patchItem(id, { status: 'importing' })
      message.value = 'Retrying the saved import.'
    },
    add(id: string) {
      if (items.value.find(item => item.id === id)?.status !== 'ready') return
      if (layers.value[activeDesign.value].some(layer => layer.id === id)) return
      updateLayers(current => [{ id, visible: true, opacity: 75 }, ...current])
      message.value = `Added to ${designNames[activeDesign.value]}.`
    },
    remove(id: string) {
      updateLayers(current => current.filter(layer => layer.id !== id))
      if (inspection.value === id) inspection.value = null
      message.value = 'Removed from this Design. Still available in Data Library.'
    },
    setVisible(id: string, visible: boolean) {
      updateLayers(current => current.map(layer => layer.id === id ? { ...layer, visible } : layer))
      if (!visible && inspection.value === id) inspection.value = null
    },
    setOpacity(id: string, opacity: number) {
      updateLayers(current => current.map(layer => layer.id === id ? { ...layer, opacity } : layer))
    },
    move(id: string, direction: -1 | 1) {
      updateLayers(current => {
        const from = current.findIndex(layer => layer.id === id)
        const to = from + direction
        if (from < 0 || to < 0 || to >= current.length) return current
        const source = current[from]
        const target = current[to]
        if (!source || !target) return current
        const next = [...current]
        next[from] = target
        next[to] = source
        return next
      })
    },
    rename(id: string, name: string) { if (name.trim()) patchItem(id, { name: name.trim() }) },
    deleteItem(id: string): boolean {
      if (items.value.some(item => item.inputId === id) || items.value.find(item => item.id === id)?.status === 'importing') return false
      items.value = items.value.filter(item => item.id !== id)
      updateLayers(current => current.filter(layer => layer.id !== id))
      if (inspection.value === id) inspection.value = null
      message.value = 'Deleted from the library. Other saved Designs may retain an unavailable reference.'
      return true
    },
    switchDesign(id: DesignId) { activeDesign.value = id; inspection.value = null },
    inspect(id: string) {
      if (items.value.find(item => item.id === id)?.status !== 'ready' || !layers.value[activeDesign.value].some(layer => layer.id === id && layer.visible)) return
      inspection.value = inspection.value === id ? null : id
    },
  }
}
export type LibraryReferenceModel = ReturnType<typeof createLibraryReference>
