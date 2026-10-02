import type { TypeScriptImportFact, TypeScriptSourceFact } from './source-facts'
import { matchesPathPattern } from './policy-harness'

export interface UnusedCodeOptions {
  /** Files the check reports on (globs). */
  readonly checked: readonly string[]
  /** Surfaces outside the checked files whose imports keep a file in use (globs). */
  readonly consumers: readonly string[]
  /** Globs never reported: tests, declarations, generated code. */
  readonly ignored: readonly string[]
  /** Test files (globs): what only they import is reported as test-only. */
  readonly tests: readonly string[]
  /** Files loaded from outside the import graph (HTML entries, `new Worker(new URL(…))`), each with the reason. */
  readonly entryPoints: Readonly<Record<string, string>>
  /** Module aliases (Vite `resolve.alias`, tsconfig `paths`) to every file they can resolve to. */
  readonly aliases: Readonly<Record<string, readonly string[]>>
}

export interface UnusedCodeReport {
  /** Checked files no entry point or consumer reaches through production imports. */
  readonly files: readonly string[]
  /** `path#name` for each value export of a checked file that no other module imports. */
  readonly exports: readonly string[]
  /** The same for type-only exports (interfaces, type aliases, `export type`). */
  readonly typeExports: readonly string[]
  /** `path#name` for each value export only tests import. */
  readonly testOnlyExports: readonly string[]
  /** The same for type-only exports. */
  readonly testOnlyTypeExports: readonly string[]
}

/**
 * Lists files no production import chain reaches from an entry point or a
 * consumer, exports no other module imports, and exports only tests import.
 * An import of a name credits that name, following named and `*` re-exports to
 * the declaring file; a namespace, dynamic or `import('…')` type import credits
 * the members the importer reads (`ns.member`, destructured names, a type
 * qualifier), and every export only when the module object escapes. A
 * re-export alone credits nothing: the barrel's own name is what another
 * module must import.
 */
export function findUnusedCode(
  graph: readonly TypeScriptSourceFact[],
  options: UnusedCodeOptions,
): UnusedCodeReport {
  const byPath = new Map(graph.map((source) => [source.path, source]))
  const matches = (path: string, globs: readonly string[]) =>
    globs.some((glob) => matchesPathPattern(path, glob))
  const isChecked = (path: string) =>
    matches(path, options.checked) && !matches(path, options.ignored)
  const resolve = (target: string): readonly string[] => options.aliases[target] ?? [target]
  const targetsOf = (edge: TypeScriptImportFact): readonly string[] => resolve(edge.target)

  const roots = [
    ...Object.keys(options.entryPoints),
    ...graph.map(({ path }) => path).filter((path) => matches(path, options.consumers)),
  ]
  const reached = new Set(roots)
  const pending = [...roots]
  while (pending.length > 0) {
    for (const edge of byPath.get(pending.pop()!)?.imports ?? []) {
      for (const target of targetsOf(edge)) {
        if (!byPath.has(target) || reached.has(target) || matches(target, options.ignored)) continue
        reached.add(target)
        pending.push(target)
      }
    }
  }

  const used = new Set<string>()
  const testUsed = new Set<string>()
  let into = used
  const credit = (path: string, name: string, seen = new Set<string>()): void => {
    const key = `${path}#${name}`
    if (seen.has(key)) return
    seen.add(key)
    into.add(key)
    const source = byPath.get(path)
    if (!source) return
    let declared = false
    for (const fact of source.exportFacts) {
      if (fact.exportedName !== name) continue
      declared = true
      if (fact.kind === 'named-reexport' && fact.target && fact.sourceName) {
        for (const target of resolve(fact.target)) credit(target, fact.sourceName, seen)
      } else if (fact.kind === 'namespace-reexport' && fact.target) {
        for (const target of resolve(fact.target)) creditAll(target, seen)
      }
    }
    if (declared || name === 'default') return
    for (const fact of source.exportFacts) {
      if (fact.kind !== 'star-reexport' || !fact.target) continue
      for (const target of resolve(fact.target)) credit(target, name, seen)
    }
  }
  const creditAll = (path: string, seen = new Set<string>()): void => {
    const source = byPath.get(path)
    if (!source) return
    for (const fact of source.exportFacts) {
      if (fact.kind === 'star-reexport') {
        for (const target of fact.target ? resolve(fact.target) : []) {
          if (seen.has(`${target}#*`)) continue
          seen.add(`${target}#*`)
          creditAll(target, seen)
        }
      } else if (fact.exportedName) {
        credit(path, fact.exportedName, seen)
      }
    }
  }

  for (const source of graph) {
    into = matches(source.path, options.tests) ? testUsed : used
    for (const edge of source.imports) {
      if (edge.kind === 'reexport') continue
      const wholeModule = edge.kind !== 'static'
        || edge.bindings.some((binding) => binding.importedName === '*')
      for (const target of targetsOf(edge)) {
        if (target === source.path) continue
        for (const binding of edge.bindings) {
          if (binding.importedName !== '*') credit(target, binding.importedName)
        }
        if (!wholeModule) continue
        if (edge.members === null) creditAll(target)
        else for (const member of edge.members) credit(target, member)
      }
    }
  }

  const checkedSources = graph.filter((source) => isChecked(source.path))
  const files = checkedSources
    .filter((source) => !reached.has(source.path))
    .map((source) => source.path)
  const exportsWhere = (typeOnly: boolean, unused: (key: string) => boolean) =>
    checkedSources.flatMap((source) => {
      const names = new Map<string, boolean>()
      for (const fact of source.exportFacts) {
        if (fact.kind === 'star-reexport' || !fact.exportedName) continue
        names.set(fact.exportedName, (names.get(fact.exportedName) ?? true) && fact.typeOnly)
      }
      return [...names]
        .filter(([name, isType]) => isType === typeOnly && unused(`${source.path}#${name}`))
        .map(([name]) => `${source.path}#${name}`)
    }).sort()
  const unused = (key: string) => !used.has(key) && !testUsed.has(key)
  const testOnly = (key: string) => !used.has(key) && testUsed.has(key)

  return {
    files: files.sort(),
    exports: exportsWhere(false, unused),
    typeExports: exportsWhere(true, unused),
    testOnlyExports: exportsWhere(false, testOnly),
    testOnlyTypeExports: exportsWhere(true, testOnly),
  }
}
