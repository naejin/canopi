import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every IPC wrapper is reached from production code, so a native command whose
// only caller is an unused wrapper cannot hide behind the native registry check.
const SRC = join(__dirname, '..')
const IPC = join(SRC, 'ipc')

function productionSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'generated') continue
      files.push(...productionSources(path))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(path)
    }
  }
  return files
}

describe('IPC wrappers', () => {
  it('are each imported by production code outside their own module', () => {
    const sources = productionSources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    const unused: string[] = []
    for (const file of readdirSync(IPC).filter((name) => name.endsWith('.ts'))) {
      const modulePath = join(IPC, file)
      const text = readFileSync(modulePath, 'utf8')
      for (const [, name] of text.matchAll(/^export (?:async )?function (\w+)/gm)) {
        const used = sources.some((source) => source.path !== modulePath
          && new RegExp(`\\b${name}\\b`).test(source.text))
        if (!used) unused.push(`${relative(SRC, modulePath)}: ${name}`)
      }
    }
    expect(unused).toEqual([])
  })
})
