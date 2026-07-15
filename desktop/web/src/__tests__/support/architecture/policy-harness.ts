import type {
  TypeScriptImportFact,
  TypeScriptSourceFact,
} from './source-facts'
import type { CssDeclarationFact, CssFileFacts } from './css-facts'

type ImportKind = TypeScriptImportFact['kind']
type WriteKind = TypeScriptSourceFact['writes'][number]['kind']
type CallKind = TypeScriptSourceFact['calls'][number]['kind']

interface ImportPolicyBase {
  readonly name: string
  readonly from?: readonly string[]
  readonly edgeKinds?: readonly ImportKind[]
}

export interface ForbidImportsPolicy extends ImportPolicyBase {
  readonly kind: 'forbid-imports'
  readonly from: readonly string[]
  readonly targets: readonly string[]
  readonly exceptFrom?: readonly string[]
  readonly exceptTargets?: readonly string[]
  readonly allowTypeOnlyTargets?: readonly string[]
  readonly importedNames?: readonly string[]
}

export interface ForbidNonLiteralDynamicImportsPolicy {
  readonly kind: 'forbid-nonliteral-dynamic-imports'
  readonly name: string
  readonly from: readonly string[]
  readonly exceptFrom?: readonly string[]
}

export interface ConfineImportersPolicy extends ImportPolicyBase {
  readonly kind: 'confine-importers'
  readonly targets: readonly string[]
  readonly allowedFrom: readonly string[]
}

export interface RequireImportsPolicy extends ImportPolicyBase {
  readonly kind: 'require-imports'
  readonly from: readonly string[]
  readonly targets: readonly string[]
}

export interface NamedImportsPolicy extends ImportPolicyBase {
  readonly kind: 'named-imports'
  readonly from: readonly string[]
  readonly target: string
  readonly requiredNames: readonly string[]
  readonly allowedNames: readonly string[]
}

export interface ForbidExportsPolicy {
  readonly kind: 'forbid-exports'
  readonly name: string
  readonly from: readonly string[]
  readonly names: readonly string[]
}

export interface ForbidSourceSymbolsPolicy {
  readonly kind: 'forbid-source-symbols'
  readonly name: string
  readonly from: readonly string[]
  readonly names: readonly string[]
}

export interface ConfineSymbolsPolicy {
  readonly kind: 'confine-symbols'
  readonly name: string
  readonly from?: readonly string[]
  readonly names: readonly string[]
  readonly allowedFrom: readonly string[]
}

export interface ForbidWritesPolicy {
  readonly kind: 'forbid-writes'
  readonly name: string
  readonly from: readonly string[]
  readonly exceptFrom?: readonly string[]
  readonly targets?: readonly string[]
  readonly properties?: readonly string[]
  readonly values?: readonly string[]
  readonly writeKinds?: readonly WriteKind[]
}

export interface ForbidCallsPolicy {
  readonly kind: 'forbid-calls'
  readonly name: string
  readonly from: readonly string[]
  readonly exceptFrom?: readonly string[]
  readonly targets?: readonly string[]
  readonly properties?: readonly string[]
  readonly callKinds?: readonly CallKind[]
}

export interface SourceTombstonesPolicy {
  readonly kind: 'source-tombstones'
  readonly name: string
  readonly files?: readonly string[]
  readonly symbols?: ReadonlyArray<{
    readonly from: readonly string[]
    readonly names: readonly string[]
  }>
}

export type ArchitecturePolicy =
  | ForbidImportsPolicy
  | ForbidNonLiteralDynamicImportsPolicy
  | ConfineImportersPolicy
  | RequireImportsPolicy
  | NamedImportsPolicy
  | ForbidExportsPolicy
  | ForbidSourceSymbolsPolicy
  | ConfineSymbolsPolicy
  | ForbidWritesPolicy
  | ForbidCallsPolicy
  | SourceTombstonesPolicy

export function collectArchitecturePolicyViolations(
  graph: readonly TypeScriptSourceFact[],
  policies: readonly ArchitecturePolicy[],
): string[] {
  const violations: string[] = []

  for (const policy of policies) {
    collectPolicyMissingSourceViolations(graph, policy, violations)

    switch (policy.kind) {
      case 'forbid-imports':
        collectForbiddenImportViolations(graph, policy, violations)
        break
      case 'forbid-nonliteral-dynamic-imports':
        collectNonLiteralDynamicImportViolations(graph, policy, violations)
        break
      case 'confine-importers':
        collectConfinedImporterViolations(graph, policy, violations)
        break
      case 'require-imports':
        collectRequiredImportViolations(graph, policy, violations)
        break
      case 'named-imports':
        collectNamedImportViolations(graph, policy, violations)
        break
      case 'forbid-exports':
        for (const source of matchingSources(graph, policy.from)) {
          for (const name of policy.names) {
            if (source.exportedNames.includes(name)) {
              violations.push(`[${policy.name}] ${source.path} exports forbidden symbol ${name}`)
            }
          }
        }
        break
      case 'forbid-source-symbols':
        collectForbiddenSourceSymbolViolations(graph, policy, violations)
        break
      case 'confine-symbols':
        collectConfinedSymbolViolations(graph, policy, violations)
        break
      case 'forbid-writes':
        collectForbiddenWriteViolations(graph, policy, violations)
        break
      case 'forbid-calls':
        collectForbiddenCallViolations(graph, policy, violations)
        break
      case 'source-tombstones':
        collectSourceTombstoneViolations(graph, policy, violations)
        break
    }
  }

  return violations
}

function collectPolicyMissingSourceViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ArchitecturePolicy,
  violations: string[],
): void {
  if (policy.kind === 'source-tombstones') return
  if (!('from' in policy) || !policy.from) return
  collectMissingRequiredPolicySources(graph, policy.name, policy.from, violations)
}

function collectMissingRequiredPolicySources(
  graph: readonly TypeScriptSourceFact[],
  policyName: string,
  patterns: readonly string[],
  violations: string[],
): void {
  for (const pattern of patterns) {
    if (pattern.includes('*')) continue
    if (!graph.some((source) => matchesPathPattern(source.path, pattern))) {
      violations.push(`[${policyName}] required policy source is missing: ${pattern}`)
    }
  }
}

function collectForbiddenImportViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ForbidImportsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    if (matchesAny(source.path, policy.exceptFrom ?? [])) continue
    for (const edge of source.imports) {
      if (!matchesImportKind(edge, policy.edgeKinds)) continue
      if (!matchesAny(edge.target, policy.targets)) continue
      if (matchesAny(edge.target, policy.exceptTargets ?? [])) continue
      if (isTypeOnlyImport(edge) && matchesAny(edge.target, policy.allowTypeOnlyTargets ?? [])) {
        continue
      }
      if (policy.importedNames && !edge.bindings.some(
        (binding) => policy.importedNames?.includes(binding.importedName),
      )) continue
      violations.push(formatImportViolation(policy.name, source.path, edge))
    }
  }
}

function collectNonLiteralDynamicImportViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ForbidNonLiteralDynamicImportsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    if (matchesAny(source.path, policy.exceptFrom ?? [])) continue
    for (const edge of source.imports) {
      if (edge.kind !== 'dynamic' || edge.literalSpecifier) continue
      violations.push(formatImportViolation(policy.name, source.path, edge))
    }
  }
}

function collectConfinedImporterViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ConfineImportersPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from ?? ['**'])) {
    if (matchesAny(source.path, policy.allowedFrom)) continue
    for (const edge of source.imports) {
      if (!matchesImportKind(edge, policy.edgeKinds)) continue
      if (!matchesAny(edge.target, policy.targets)) continue
      violations.push(
        `${formatImportViolation(policy.name, source.path, edge)}; allowed importers: ${policy.allowedFrom.join(', ')}`,
      )
    }
  }
}

function collectRequiredImportViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: RequireImportsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    for (const target of policy.targets) {
      const found = source.imports.some((edge) =>
        matchesImportKind(edge, policy.edgeKinds) && matchesPathPattern(edge.target, target),
      )
      if (!found) {
        violations.push(`[${policy.name}] ${source.path} is missing required import matching ${target}`)
      }
    }
  }
}

function collectNamedImportViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: NamedImportsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    const edges = source.imports.filter((edge) =>
      matchesImportKind(edge, policy.edgeKinds) && matchesPathPattern(edge.target, policy.target),
    )
    const importedNames = new Set(
      edges.flatMap((edge) => edge.bindings.map((binding) => binding.importedName)),
    )
    for (const requiredName of policy.requiredNames) {
      if (!importedNames.has(requiredName)) {
        violations.push(
          `[${policy.name}] ${source.path} must import ${requiredName} from ${policy.target}`,
        )
      }
    }
    for (const importedName of [...importedNames].sort()) {
      if (!policy.allowedNames.includes(importedName)) {
        violations.push(
          `[${policy.name}] ${source.path} imports unexpected ${importedName} from ${policy.target}; allowed names: ${policy.allowedNames.join(', ')}`,
        )
      }
    }
  }
}

function collectForbiddenSourceSymbolViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ForbidSourceSymbolsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    for (const name of policy.names) {
      if (source.identifiers.includes(name)) {
        violations.push(`[${policy.name}] ${source.path} contains forbidden symbol ${name}`)
      }
    }
  }
}

function collectConfinedSymbolViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ConfineSymbolsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from ?? ['**'])) {
    if (matchesAny(source.path, policy.allowedFrom)) continue
    for (const name of policy.names) {
      if (source.identifiers.includes(name)) {
        violations.push(
          `[${policy.name}] ${source.path} contains confined symbol ${name}; allowed sources: ${policy.allowedFrom.join(', ')}`,
        )
      }
    }
  }
}

function collectForbiddenWriteViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ForbidWritesPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    if (matchesAny(source.path, policy.exceptFrom ?? [])) continue
    for (const write of source.writes) {
      if (policy.writeKinds && !policy.writeKinds.includes(write.kind)) continue
      if (policy.targets && !matchesAny(write.target, policy.targets)) continue
      if (policy.properties && (!write.property || !policy.properties.includes(write.property))) {
        continue
      }
      if (policy.values && !policy.values.includes(write.value)) continue
      violations.push(
        `[${policy.name}] ${source.path}:${write.line} writes ${write.target} = ${write.value}`,
      )
    }
  }
}

function collectForbiddenCallViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: ForbidCallsPolicy,
  violations: string[],
): void {
  for (const source of matchingSources(graph, policy.from)) {
    if (matchesAny(source.path, policy.exceptFrom ?? [])) continue
    for (const call of source.calls) {
      if (policy.callKinds && !policy.callKinds.includes(call.kind)) continue
      if (policy.targets && !matchesAny(call.target, policy.targets)) continue
      if (policy.properties && (!call.property || !policy.properties.includes(call.property))) {
        continue
      }
      violations.push(
        `[${policy.name}] ${source.path}:${call.line} ${call.kind === 'new' ? 'constructs' : 'calls'} ${call.target}`,
      )
    }
  }
}

function collectSourceTombstoneViolations(
  graph: readonly TypeScriptSourceFact[],
  policy: SourceTombstonesPolicy,
  violations: string[],
): void {
  const paths = new Set(graph.map((source) => source.path))
  for (const file of policy.files ?? []) {
    if (paths.has(file)) violations.push(`[${policy.name}] retired source still exists: ${file}`)
  }
  for (const symbolPolicy of policy.symbols ?? []) {
    for (const source of matchingSources(graph, symbolPolicy.from)) {
      for (const name of symbolPolicy.names) {
        if (source.identifiers.includes(name)) {
          violations.push(`[${policy.name}] ${source.path} contains retired symbol ${name}`)
        }
      }
    }
  }
}

function matchingSources(
  graph: readonly TypeScriptSourceFact[],
  patterns: readonly string[],
): TypeScriptSourceFact[] {
  return graph.filter((source) => matchesAny(source.path, patterns))
}

function formatImportViolation(
  policyName: string,
  importer: string,
  edge: TypeScriptImportFact,
): string {
  return `[${policyName}] ${importer}:${edge.line}:${edge.column} imports ${edge.target} via "${edge.specifier}" (${edge.kind})`
}

function matchesImportKind(
  edge: TypeScriptImportFact,
  edgeKinds: readonly ImportKind[] | undefined,
): boolean {
  return !edgeKinds || edgeKinds.includes(edge.kind)
}

function isTypeOnlyImport(edge: TypeScriptImportFact): boolean {
  return edge.typeOnly
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(value, pattern))
}

export function matchesPathPattern(value: string, pattern: string): boolean {
  let expression = ''
  let index = 0

  while (index < pattern.length) {
    const char = pattern[index]!
    if (char !== '*') {
      expression += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
      index += 1
      continue
    }

    const isGlobStar = pattern[index + 1] === '*'
    if (!isGlobStar) {
      expression += '[^/]*'
      index += 1
      continue
    }

    const followedBySlash = pattern[index + 2] === '/'
    expression += followedBySlash ? '(?:.*/)?' : '.*'
    index += followedBySlash ? 3 : 2
  }

  return new RegExp(`^${expression}$`).test(value)
}

export interface CssPolicyException {
  readonly file: string
  readonly rule: string
  readonly atRules: readonly string[]
  readonly property: string
  readonly value: string
  readonly reason: string
}

export interface CssDeclarationPolicy {
  readonly name: string
  readonly properties: readonly string[]
  readonly rawValue: RegExp
  readonly requiredValue: RegExp
  readonly accepts?: (declaration: CssDeclarationFact) => boolean
  readonly exceptions: readonly CssPolicyException[]
}

export function collectCssPolicyViolations(
  files: readonly CssFileFacts[],
  policies: readonly CssDeclarationPolicy[],
): string[] {
  const violations: string[] = []

  for (const policy of policies) {
    const exceptionKeys = new Set<string>()
    const usedExceptionKeys = new Set<string>()
    for (const exception of policy.exceptions) {
      const key = cssExceptionKey(exception)
      if (!exception.reason.trim()) {
        violations.push(`[${policy.name}] CSS exception reason is empty: ${key}`)
      }
      if (exceptionKeys.has(key)) {
        violations.push(`[${policy.name}] duplicate CSS exception: ${key}`)
      }
      exceptionKeys.add(key)
    }

    for (const file of files) {
      for (const declaration of file.declarations) {
        if (!matchesAny(declaration.property, policy.properties)) continue
        policy.rawValue.lastIndex = 0
        if (!policy.rawValue.test(declaration.value)) continue
        if (policy.accepts) {
          if (policy.accepts(declaration)) continue
        } else {
          policy.requiredValue.lastIndex = 0
          if (policy.requiredValue.test(declaration.value)) continue
        }

        const declarationKey = cssDeclarationExceptionKey(declaration)
        const exception = policy.exceptions.find((candidate) =>
          cssExceptionMatches(candidate, declaration),
        )
        if (exception && !usedExceptionKeys.has(declarationKey)) {
          usedExceptionKeys.add(declarationKey)
          continue
        }
        violations.push(
          `[${policy.name}] ${declaration.path}:${declaration.line} ${declaration.property}: ${declaration.value}`,
        )
      }
    }

    for (const exception of policy.exceptions) {
      const key = cssExceptionKey(exception)
      if (!usedExceptionKeys.has(key)) {
        violations.push(`[${policy.name}] unused CSS exception: ${key} (${exception.reason})`)
      }
    }
  }

  return violations
}

function cssExceptionMatches(
  exception: CssPolicyException,
  declaration: CssDeclarationFact,
): boolean {
  return exception.file === declaration.path
    && exception.property === declaration.property
    && exception.value === declaration.value
    && exception.rule === declaration.rule
    && arraysEqual(exception.atRules, declaration.atRules)
}

function cssExceptionKey(exception: CssPolicyException): string {
  return [
    exception.file,
    cssAtRuleContext(exception.atRules),
    exception.rule,
    exception.property,
    exception.value,
  ].join('|')
}

function cssDeclarationExceptionKey(declaration: CssDeclarationFact): string {
  return [
    declaration.path,
    cssAtRuleContext(declaration.atRules),
    declaration.rule,
    declaration.property,
    declaration.value,
  ].join('|')
}

function cssAtRuleContext(atRules: readonly string[]): string {
  return atRules.length > 0 ? atRules.join(' > ') : '<root>'
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
