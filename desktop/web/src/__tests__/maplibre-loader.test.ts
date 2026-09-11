import { expect, it, vi } from 'vitest'

const library = vi.hoisted(() => ({ Map: vi.fn(), addProtocol: vi.fn(), setWorkerUrl: vi.fn() }))
vi.mock('maplibre-gl', () => ({ ...library, default: undefined }))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/assets/map-worker.js' }))

it('configures the bundled worker before exposing the shared map module', async () => {
  const { loadMapLibreModule } = await import('../maplibre/loader')
  const [first, second] = await Promise.all([loadMapLibreModule(), loadMapLibreModule()])
  expect(first).toBe(second)
  expect(first.Map).toBe(library.Map)
  expect(library.setWorkerUrl).toHaveBeenCalledExactlyOnceWith('/assets/map-worker.js')
})
