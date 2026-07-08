import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { describe, expect, it } from 'vitest'

declare const process: {
  cwd(): string
  env: {
    TMPDIR?: string
    TEMP?: string
    TMP?: string
  }
}

const fsWithWriteAndTemp = fs as unknown as {
  existsSync(path: string): boolean
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  mkdtempSync(prefix: string): string
  readFileSync(path: string, encoding: 'utf8'): string
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  writeFileSync(path: string, content: string): void
}

const webRoot = process.cwd()
const scriptPath = joinPath(webRoot, 'scripts/package-web-edition.mjs')

describe('Web Edition packaging', () => {
  it('creates a versioned /app artifact with manifest checksums and an index entry', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(joinPath(dist, 'assets'), { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script type="module" src="/app/assets/web.js"></script>\n')
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'assets', 'web.js'), "console.log('web')\n")
      writeCatalogFixture(dist)

      const { packageWebEdition } = await loadPackager()
      await packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })

      const artifactDir = joinPath(out, 'canopi-web-edition-v0.9.1-abcdef1')
      const manifestPath = joinPath(artifactDir, 'canopi-web-edition-manifest.json')
      const manifest = JSON.parse(fsWithWriteAndTemp.readFileSync(manifestPath, 'utf8')) as {
        version: string
        commit: string
        basePath: string
        spaFallback: { source: string; destination: string; status: number }
        files: Array<{ path: string; bytes: number; sha256: string }>
      }

      expect(fsWithWriteAndTemp.existsSync(joinPath(artifactDir, 'index.html'))).toBe(true)
      expect(fsWithWriteAndTemp.existsSync(joinPath(artifactDir, 'web.html'))).toBe(false)
      expect(fsWithWriteAndTemp.existsSync(joinPath(out, 'canopi-web-edition-v0.9.1-abcdef1.tar.gz'))).toBe(true)
      expect(manifest.version).toBe('0.9.1')
      expect(manifest.commit).toBe('abcdef1')
      expect(manifest.basePath).toBe('/app/')
      expect(manifest.spaFallback).toEqual({
        source: '/app/*',
        destination: '/app/index.html',
        status: 200,
      })
      expect(manifest.files.map((file) => file.path).sort()).toEqual([
        'assets/web.js',
        'canopi-catalog/images/images-0000.parquet',
        'canopi-catalog/manifest.json',
        'canopi-catalog/names/names-en.parquet',
        'canopi-catalog/species/species-0000.parquet',
        'index.html',
      ])
      expect(manifest.files.find((file) => file.path === 'assets/web.js')).toMatchObject({
        bytes: 19,
        sha256: 'bf9701e79b9afe9cdd0c900f3e9e890906762d7e71bf5e19d3d4860b3349dd21',
      })
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when a generated asset exceeds the Cloudflare Pages per-asset limit', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '0123456789')

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 8,
      })).rejects.toThrow(/Cloudflare Pages per-asset limit.*web\.html/s)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when the generated catalog manifest is missing', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/missing generated Species Catalog manifest/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when supported-filter metadata is missing from the catalog manifest', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      writeCatalogFixture(dist, (manifest) => {
        manifest.supported_filters = []
      })

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/missing supported-filter metadata/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when a generated catalog asset checksum does not match its manifest entry', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      writeCatalogFixture(dist, (manifest) => {
        const assets = manifest.assets as {
          species: Array<{ sha256: string }>
        }
        assets.species[0]!.sha256 = 'not-the-real-checksum'
      })

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/checksum mismatch.*species\/species-0000\.parquet/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when a generated catalog asset listed in the manifest is missing', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      writeCatalogFixture(dist)
      fsWithWriteAndTemp.rmSync(joinPath(dist, 'canopi-catalog/species/species-0000.parquet'))

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/catalog asset is missing.*species\/species-0000\.parquet/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when a generated catalog asset byte count does not match its manifest entry', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      writeCatalogFixture(dist, (manifest) => {
        const assets = manifest.assets as {
          species: Array<{ bytes: number }>
        }
        assets.species[0]!.bytes = 999
      })

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/byte count mismatch.*species\/species-0000\.parquet/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when the static artifact contains raw DuckDB WASM', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(joinPath(dist, 'assets'), { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'assets', 'duckdb-browser.wasm'), 'raw-wasm')
      writeCatalogFixture(dist)

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
      })).rejects.toThrow(/must not bundle DuckDB raw WASM/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails when the Web Edition artifact exceeds the Cloudflare Pages file-count limit', async () => {
      const workspace = createWorkspace()
    try {
      const dist = joinPath(workspace, 'dist-web')
      const out = joinPath(workspace, 'artifacts')
      fsWithWriteAndTemp.mkdirSync(dist, { recursive: true })
      fsWithWriteAndTemp.writeFileSync(joinPath(dist, 'web.html'), '<script></script>')
      writeCatalogFixture(dist)

      const { packageWebEdition } = await loadPackager()

      await expect(packageWebEdition({
        distRoot: dist,
        artifactRoot: out,
        version: '0.9.1',
        commit: 'abcdef1',
        maxAssetBytes: 1024,
        maxFileCount: 4,
      })).rejects.toThrow(/above the Cloudflare Pages file limit 4/i)
    } finally {
      fsWithWriteAndTemp.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

function createWorkspace(): string {
  return fsWithWriteAndTemp.mkdtempSync(joinPath(
    process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp',
    'canopi-web-artifact-',
  ))
}

function writeCatalogFixture(
  dist: string,
  mutateManifest?: (manifest: Record<string, unknown>) => void,
): void {
  const catalogRoot = joinPath(dist, 'canopi-catalog')
  const files = [
    ['species/species-0000.parquet', 'species-data'],
    ['names/names-en.parquet', 'names-data'],
    ['images/images-0000.parquet', 'image-data'],
  ] as const
  for (const [path, content] of files) {
    const fullPath = joinPath(catalogRoot, path)
    fsWithWriteAndTemp.mkdirSync(fullPath.split('/').slice(0, -1).join('/'), { recursive: true })
    fsWithWriteAndTemp.writeFileSync(fullPath, content)
  }
  const manifest = {
    asset_format: 'parquet',
    cloudflare_pages: {
      max_asset_bytes: 1024,
    },
    supported_filters: [
      {
        key: 'climate_zones',
        options_key: 'climate_zones',
        predicate: { kind: 'json_array_any', columns: ['climate_zones'] },
      },
    ],
    assets: {
      species: [catalogAssetEntry('species/species-0000.parquet', 'species-data')],
      names: {
        en: catalogAssetEntry('names/names-en.parquet', 'names-data'),
      },
      images: [catalogAssetEntry('images/images-0000.parquet', 'image-data')],
    },
  }
  mutateManifest?.(manifest)
  fsWithWriteAndTemp.writeFileSync(joinPath(catalogRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function catalogAssetEntry(path: string, content: string): { path: string; bytes: number; sha256: string } {
  return {
    path,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

async function loadPackager(): Promise<{
  packageWebEdition(options: {
    distRoot: string
    artifactRoot: string
    version: string
    commit: string
    maxAssetBytes: number
    maxFileCount?: number
  }): Promise<void>
}> {
  return await import(toFileUrl(scriptPath)) as {
    packageWebEdition(options: {
      distRoot: string
      artifactRoot: string
      version: string
      commit: string
      maxAssetBytes: number
      maxFileCount?: number
    }): Promise<void>
  }
}

function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/, '')
      return part.replace(/^\/+|\/+$/g, '')
    })
    .join('/')
}

function toFileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
