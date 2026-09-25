import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Packaged Desktop builds enforce `script-src 'self'`. Pixi v8 otherwise
// compiles uniform sync with `new Function`, which that policy rejects, so the
// shared map scene fails with "Map unavailable". Pixi's documented route is
// its `unsafe-eval` shim module, which must load before any Pixi renderer.
const SRC = join(__dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

describe('Pixi under the production CSP', () => {
  it('loads the unsafe-eval shim before Pixi in every module that imports Pixi', () => {
    const offenders = sourceFiles(SRC).filter((path) => {
      const text = readFileSync(path, 'utf8')
      const pixi = text.search(/from 'pixi\.js'/)
      if (pixi < 0) return false
      const shim = text.indexOf("import 'pixi.js/unsafe-eval'")
      return shim < 0 || shim > pixi
    }).map((path) => relative(SRC, path))
    expect(offenders).toEqual([])
  })
})
