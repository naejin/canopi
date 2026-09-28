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
    // Identifiers per source, tokenised once, so the check stays linear in the tree size.
    const sources = productionSources(SRC).map((path) => ({
      path,
      identifiers: new Set(readFileSync(path, 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? []),
    }))
    const wrappers: string[] = []
    const unused: string[] = []
    for (const file of readdirSync(IPC).filter((name) => name.endsWith('.ts'))) {
      const modulePath = join(IPC, file)
      const text = readFileSync(modulePath, 'utf8')
      for (const [, name] of text.matchAll(/^export (?:const|(?:async )?function) (\w+)/gm)) {
        if (!name) continue
        wrappers.push(name)
        const used = sources.some((source) => source.path !== modulePath && source.identifiers.has(name))
        if (!used) unused.push(`${relative(SRC, modulePath)}: ${name}`)
      }
    }
    // The wrapper modules must have been found, or the check proves nothing.
    expect(wrappers.length).toBeGreaterThan(10)
    expect(unused).toEqual([])
  })
})
