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

  // wbspatialstats declares AGPL-3.0-or-later in its own Cargo.toml and is linked into
  // both the whitebox-wasm module and the GeoLibre CLI, whatever the package-level labels say.
  it('names the AGPL-3.0-or-later component and where its source is offered', () => {
    expect(notices).toMatch(/\| wbspatialstats \| [^|]+ \| https:\/\/github\.com\/opengeos\/whitebox-wasm \| AGPL-3\.0-or-later \|/)
    expect(notices).toContain('9c0ff4fdf3513f27b89c78e294610c3b418b3a4f')
    expect(notices).toMatch(/Corresponding Source/)
  })
})
