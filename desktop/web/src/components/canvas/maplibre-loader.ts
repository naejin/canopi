let mapLibreModulePromise: Promise<typeof import('maplibre-gl')> | null = null
let mapLibreCssPromise: Promise<unknown> | null = null

export function loadMapLibreModule(): Promise<typeof import('maplibre-gl')> {
  if (!mapLibreModulePromise) {
    mapLibreModulePromise = import('maplibre-gl')
  }
  return mapLibreModulePromise
}

export function loadMapLibreCss(): Promise<unknown> {
  if (!mapLibreCssPromise) {
    mapLibreCssPromise = import('maplibre-gl/dist/maplibre-gl.css')
  }
  return mapLibreCssPromise
}

export async function loadMapLibre() {
  const [module] = await Promise.all([
    loadMapLibreModule(),
    loadMapLibreCss(),
  ])
  return module
}
