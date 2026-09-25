import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Tests run from desktop/web.
const desktop = resolve(process.cwd(), '..')
const notices = readFileSync(resolve(desktop, 'THIRD_PARTY_NOTICES.md'), 'utf8')
const installed = (name: string): string =>
  JSON.parse(readFileSync(resolve(desktop, `web/node_modules/${name}/package.json`), 'utf8')).version

describe('third-party notices', () => {
  it.each([
    'maplibre-gl-raster',
    'cog-tiler-wasm',
    'whitebox-wasm',
    '@deck.gl/core',
    '@luma.gl/core',
    'geotiff',
    'proj4',
    'geotiff-geokeys-to-proj4',
    'maplibre-gl',
  ])('names the installed version of %s', (name) => {
    expect(notices).toContain(`| ${name} | ${installed(name)} |`)
  })

  it('names the GeoLibre revision the app records as provenance', () => {
    const geolibre = readFileSync(resolve(desktop, 'src/services/lidar/geolibre.rs'), 'utf8')
    const revision = /GEOLIBRE_REVISION: &str = "([0-9a-f]{40})"/.exec(geolibre)?.[1]
    expect(revision).toBeDefined()
    expect(notices).toContain(revision!)
  })
})
