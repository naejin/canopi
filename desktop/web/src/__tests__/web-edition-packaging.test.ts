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
})

function createWorkspace(): string {
  return fsWithWriteAndTemp.mkdtempSync(joinPath(
    process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp',
    'canopi-web-artifact-',
  ))
}

async function loadPackager(): Promise<{
  packageWebEdition(options: {
    distRoot: string
    artifactRoot: string
    version: string
    commit: string
    maxAssetBytes: number
  }): Promise<void>
}> {
  return await import(toFileUrl(scriptPath)) as {
    packageWebEdition(options: {
      distRoot: string
      artifactRoot: string
      version: string
      commit: string
      maxAssetBytes: number
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
