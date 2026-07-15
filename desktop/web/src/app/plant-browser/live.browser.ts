import type { SpeciesCatalogWorkbench } from './workbench'
import { createBrowserSpeciesCatalogRuntime } from './browser-runtime'

const liveSpeciesCatalog = createBrowserSpeciesCatalogRuntime()

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = liveSpeciesCatalog.workbench

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    try {
      await liveSpeciesCatalog.dispose()
    } catch (error) {
      console.error('Failed to dispose Web Species Catalog:', error)
    }
  })
}
