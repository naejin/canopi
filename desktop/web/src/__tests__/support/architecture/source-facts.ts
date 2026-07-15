import ts from 'typescript'

export type TypeScriptImportKind = 'static' | 'dynamic' | 'import-type' | 'reexport'

export interface TypeScriptImportBindingFact {
  readonly importedName: string
  readonly localName: string
  readonly typeOnly: boolean
}

export interface TypeScriptImportFact {
  readonly kind: TypeScriptImportKind
  readonly specifier: string
  readonly bindings: readonly TypeScriptImportBindingFact[]
  readonly typeOnly: boolean
  readonly line: number
  readonly column: number
  readonly target: string
  readonly literalSpecifier: boolean
  readonly reexportAll: boolean
}

export type TypeScriptExportKind = 'local' | 'named-reexport' | 'star-reexport' | 'namespace-reexport'

export interface TypeScriptExportFact {
  readonly kind: TypeScriptExportKind
  readonly exportedName: string | null
  readonly sourceName: string | null
  readonly specifier: string | null
  readonly target: string | null
  readonly typeOnly: boolean
}

export type TypeScriptWriteKind = 'assignment' | 'update' | 'object-property'

export interface TypeScriptWriteFact {
  readonly kind: TypeScriptWriteKind
  readonly target: string
  readonly property: string | null
  readonly value: string
  readonly line: number
  readonly column: number
}

export type TypeScriptCallKind = 'call' | 'new'

export interface TypeScriptCallFact {
  readonly kind: TypeScriptCallKind
  readonly target: string
  readonly property: string | null
  readonly line: number
  readonly column: number
}

export interface TypeScriptSourceFact {
  readonly path: string
  readonly source: string
  readonly imports: readonly TypeScriptImportFact[]
  readonly exportFacts: readonly TypeScriptExportFact[]
  readonly exportedNames: readonly string[]
  readonly identifiers: readonly string[]
  readonly writes: readonly TypeScriptWriteFact[]
  readonly calls: readonly TypeScriptCallFact[]
}

export interface TypeScriptSourceInput {
  readonly path: string
  readonly source: string
}

interface ImportFactFields {
  readonly kind: TypeScriptImportKind
  readonly specifier: string
  readonly bindings: readonly TypeScriptImportBindingFact[]
  readonly line: number
  readonly column: number
  readonly typeOnly: boolean
  readonly target?: string
  readonly literalSpecifier?: boolean
  readonly reexportAll?: boolean
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const
const JAVASCRIPT_EXTENSION_REPLACEMENTS = new Map<string, readonly string[]>([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx', '.ts']],
  ['.mjs', ['.mts', '.ts']],
  ['.cjs', ['.cts', '.ts']],
])

export function parseTypeScriptSource(path: string, source: string): TypeScriptSourceFact {
  const normalizedPath = normalizePath(path)
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    normalizedPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const imports: TypeScriptImportFact[] = []
  const exportFacts: TypeScriptExportFact[] = []
  const exportedNames = new Set<string>()
  const identifiers = new Set<string>()
  const writes: TypeScriptWriteFact[] = []
  const calls: TypeScriptCallFact[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)

    if (ts.isImportDeclaration(node) && node.parent === sourceFile) {
      imports.push(importDeclarationFact(sourceFile, node))
    } else if (ts.isExportDeclaration(node) && node.parent === sourceFile) {
      collectExportDeclarationNames(node, exportedNames)
      collectExportDeclarationFacts(node, exportFacts)
      if (node.moduleSpecifier) imports.push(exportDeclarationFact(sourceFile, node))
    } else if (ts.isImportTypeNode(node)) {
      imports.push(importTypeFact(sourceFile, node))
    } else if (isDynamicImportCall(node)) {
      imports.push(dynamicImportFact(sourceFile, node))
    }

    if (isAssignmentExpression(node)) {
      writes.push(writeFact(
        sourceFile,
        node,
        'assignment',
        node.left.getText(sourceFile),
        writtenPropertyName(node.left),
        node.right.getText(sourceFile),
      ))
    } else if (isUpdateExpression(node)) {
      writes.push(writeFact(
        sourceFile,
        node,
        'update',
        node.operand.getText(sourceFile),
        writtenPropertyName(node.operand),
        ts.tokenToString(node.operator) ?? 'update',
      ))
    } else if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      const property = propertyNameText(node.name)
      if (property) {
        writes.push(writeFact(
          sourceFile,
          node,
          'object-property',
          property,
          property,
          node.initializer.getText(sourceFile),
        ))
      }
    }

    if (ts.isCallExpression(node)) {
      calls.push(callFact(sourceFile, node, 'call', node.expression))
    } else if (ts.isNewExpression(node)) {
      calls.push(callFact(sourceFile, node, 'new', node.expression))
    }

    collectExportedDeclarationNames(node, exportedNames)
    collectExportedDeclarationFacts(node, exportFacts)
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return {
    path: normalizedPath,
    source,
    imports,
    exportFacts,
    exportedNames: [...exportedNames],
    identifiers: [...identifiers],
    writes,
    calls,
  }
}

function callFact(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression | ts.NewExpression,
  kind: TypeScriptCallKind,
  expression: ts.Expression,
): TypeScriptCallFact {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    kind,
    target: expression.getText(sourceFile),
    property: memberPropertyName(expression),
    line: location.line + 1,
    column: location.character + 1,
  }
}

function memberPropertyName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return stringLiteralText(node.argumentExpression) ?? null
  }
  return null
}

function writeFact(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: TypeScriptWriteKind,
  target: string,
  property: string | null,
  value: string,
): TypeScriptWriteFact {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    kind,
    target,
    property,
    value,
    line: location.line + 1,
    column: location.character + 1,
  }
}

function isAssignmentExpression(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
}

function isUpdateExpression(
  node: ts.Node,
): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
  return (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken
      || node.operator === ts.SyntaxKind.MinusMinusToken)
}

function writtenPropertyName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return stringLiteralText(node.argumentExpression) ?? null
  }
  return ts.isIdentifier(node) ? node.text : null
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  return stringLiteralText(name)
}

export function createTypeScriptSourceGraph(
  sources: readonly TypeScriptSourceInput[],
): TypeScriptSourceFact[] {
  const parsedSources = sources.map(({ path, source }) => parseTypeScriptSource(path, source))
  const sourcePaths = new Set<string>()

  for (const source of parsedSources) {
    if (sourcePaths.has(source.path)) {
      throw new Error(`Duplicate TypeScript source path: ${source.path}`)
    }
    sourcePaths.add(source.path)
  }

  const resolvedSources = parsedSources.map((source) => ({
    ...source,
    imports: source.imports.map((edge) => cloneImportFact(edge, {
      target: resolveImportTarget(source.path, edge.specifier, sourcePaths),
    })),
    exportFacts: source.exportFacts.map((fact) => ({
      ...fact,
      target: fact.specifier
        ? resolveImportTarget(source.path, fact.specifier, sourcePaths)
        : null,
    })),
  }))

  const exportIdentitiesByPath = new Map(
    resolvedSources.map((source) => [source.path, createDirectExportIdentityMap(source.exportFacts)]),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const source of resolvedSources) {
      const identities = exportIdentitiesByPath.get(source.path)!
      for (const fact of source.exportFacts) {
        if (fact.kind === 'local' && fact.exportedName && fact.sourceName) {
          for (const edge of source.imports) {
            if (edge.kind !== 'static') continue
            const targetIdentities = exportIdentitiesByPath.get(edge.target)
            if (!targetIdentities) continue
            for (const binding of edge.bindings) {
              if (binding.localName !== fact.sourceName) continue
              if (binding.importedName === '*') {
                for (const names of targetIdentities.values()) {
                  changed = mergeExportIdentities(identities, fact.exportedName, names) || changed
                }
              } else {
                const names = targetIdentities.get(binding.importedName)
                if (names) {
                  changed = mergeExportIdentities(identities, fact.exportedName, names) || changed
                }
              }
            }
          }
        }

        if (!fact.target) continue
        const targetIdentities = exportIdentitiesByPath.get(fact.target)
        if (!targetIdentities) continue

        if (fact.kind === 'star-reexport') {
          for (const [exportedName, names] of targetIdentities) {
            if (exportedName === 'default') continue
            changed = mergeExportIdentities(identities, exportedName, names) || changed
          }
          continue
        }

        if (fact.kind === 'namespace-reexport' && fact.exportedName) {
          for (const names of targetIdentities.values()) {
            changed = mergeExportIdentities(identities, fact.exportedName, names) || changed
          }
          continue
        }

        if (fact.kind === 'named-reexport' && fact.exportedName && fact.sourceName) {
          const names = targetIdentities.get(fact.sourceName)
          if (names) {
            changed = mergeExportIdentities(identities, fact.exportedName, names) || changed
          }
        }
      }
    }
  }

  return resolvedSources.map((source) => ({
    ...source,
    exportedNames: [...new Set(
      [...exportIdentitiesByPath.get(source.path)!.values()].flatMap((names) => [...names]),
    )],
  }))
}

function createDirectExportIdentityMap(
  facts: readonly TypeScriptExportFact[],
): Map<string, Set<string>> {
  const identities = new Map<string, Set<string>>()
  for (const fact of facts) {
    if (!fact.exportedName || fact.kind === 'star-reexport') continue
    const names = new Set([fact.exportedName])
    if (fact.sourceName && fact.sourceName !== '*') names.add(fact.sourceName)
    mergeExportIdentities(identities, fact.exportedName, names)
  }
  return identities
}

function mergeExportIdentities(
  identities: Map<string, Set<string>>,
  exportedName: string,
  names: ReadonlySet<string>,
): boolean {
  let target = identities.get(exportedName)
  if (!target) {
    target = new Set([exportedName])
    identities.set(exportedName, target)
  }
  let changed = false
  for (const name of names) {
    if (target.has(name)) continue
    target.add(name)
    changed = true
  }
  return changed
}

export function discoverTypeScriptSourceGraph(
  rootUrl: URL,
  rootPath: string,
): TypeScriptSourceFact[] {
  const fileSystemRoot = fileUrlPath(rootUrl)
  const normalizedRoot = trimTrailingSlash(normalizePath(fileSystemRoot))
  const normalizedRootPath = trimSlashes(normalizePath(rootPath))
  const files = ts.sys.readDirectory(
    fileSystemRoot,
    [...SOURCE_EXTENSIONS],
    undefined,
    ['**/*'],
  )

  const sources = files.map((filePath): TypeScriptSourceInput => {
    const relativePath = pathRelativeToRoot(normalizedRoot, normalizePath(filePath))
    const source = ts.sys.readFile(filePath)
    if (source === undefined) throw new Error(`Unable to read TypeScript source: ${filePath}`)
    return {
      path: normalizedRootPath ? `${normalizedRootPath}/${relativePath}` : relativePath,
      source,
    }
  })

  sources.sort((left, right) => left.path.localeCompare(right.path))
  return createTypeScriptSourceGraph(sources)
}

function importDeclarationFact(
  sourceFile: ts.SourceFile,
  declaration: ts.ImportDeclaration,
): TypeScriptImportFact {
  const specifier = stringLiteralText(declaration.moduleSpecifier)
  if (specifier === undefined) {
    throw sourceFactError(sourceFile, declaration.moduleSpecifier, 'Import specifier must be a string literal')
  }

  const bindings: TypeScriptImportBindingFact[] = []
  const clause = declaration.importClause
  if (clause?.name) {
    bindings.push({
      importedName: 'default',
      localName: clause.name.text,
      typeOnly: clause.isTypeOnly,
    })
  }
  if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push({
      importedName: '*',
      localName: clause.namedBindings.name.text,
      typeOnly: clause.isTypeOnly,
    })
  }
  if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      bindings.push({
        importedName: element.propertyName?.text ?? element.name.text,
        localName: element.name.text,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      })
    }
  }

  return importFactAt(sourceFile, declaration, {
    kind: 'static',
    specifier,
    bindings,
    typeOnly: bindings.length > 0 && bindings.every((binding) => binding.typeOnly),
  })
}

function exportDeclarationFact(
  sourceFile: ts.SourceFile,
  declaration: ts.ExportDeclaration,
): TypeScriptImportFact {
  const specifier = stringLiteralText(declaration.moduleSpecifier!)
  if (specifier === undefined) {
    throw sourceFactError(sourceFile, declaration.moduleSpecifier!, 'Re-export specifier must be a string literal')
  }
  return importFactAt(sourceFile, declaration, {
    kind: 'reexport',
    specifier,
    bindings: reexportBindings(declaration),
    typeOnly: declaration.isTypeOnly || reexportElementsAreTypeOnly(declaration),
    reexportAll: declaration.exportClause === undefined,
  })
}

function reexportBindings(
  declaration: ts.ExportDeclaration,
): TypeScriptImportBindingFact[] {
  const clause = declaration.exportClause
  if (!clause) {
    return [{ importedName: '*', localName: '*', typeOnly: declaration.isTypeOnly }]
  }
  if (ts.isNamespaceExport(clause)) {
    return [{
      importedName: '*',
      localName: clause.name.text,
      typeOnly: declaration.isTypeOnly,
    }]
  }
  return clause.elements.map((element) => ({
    importedName: element.propertyName?.text ?? element.name.text,
    localName: element.name.text,
    typeOnly: declaration.isTypeOnly || element.isTypeOnly,
  }))
}

function importTypeFact(
  sourceFile: ts.SourceFile,
  node: ts.ImportTypeNode,
): TypeScriptImportFact {
  const specifier = ts.isLiteralTypeNode(node.argument)
    ? stringLiteralText(node.argument.literal)
    : undefined
  if (specifier === undefined) {
    throw sourceFactError(sourceFile, node.argument, 'Import type specifier must be a string literal')
  }
  return importFactAt(sourceFile, node, {
    kind: 'import-type',
    specifier,
    bindings: [],
    typeOnly: true,
  })
}

function dynamicImportFact(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): TypeScriptImportFact {
  const argument = call.arguments[0]
  const literalSpecifier = argument ? stringLiteralText(argument) : undefined
  const specifier = literalSpecifier
    ?? `<non-literal dynamic import: ${argument?.getText(sourceFile) ?? 'missing argument'}>`
  return importFactAt(sourceFile, call, {
    kind: 'dynamic',
    specifier,
    bindings: [],
    typeOnly: false,
    literalSpecifier: literalSpecifier !== undefined,
  })
}

function importFactAt(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  fields: Omit<ImportFactFields, 'line' | 'column'>,
): TypeScriptImportFact {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return createImportFact({
    ...fields,
    line: location.line + 1,
    column: location.character + 1,
  })
}

function createImportFact(fields: ImportFactFields): TypeScriptImportFact {
  return {
    kind: fields.kind,
    specifier: fields.specifier,
    bindings: fields.bindings,
    line: fields.line,
    column: fields.column,
    typeOnly: fields.typeOnly,
    target: fields.target ?? fields.specifier,
    literalSpecifier: fields.literalSpecifier ?? true,
    reexportAll: fields.reexportAll ?? false,
  }
}

function cloneImportFact(
  edge: TypeScriptImportFact,
  fields: Pick<ImportFactFields, 'target'>,
): TypeScriptImportFact {
  return createImportFact({
    kind: edge.kind,
    specifier: edge.specifier,
    bindings: edge.bindings,
    line: edge.line,
    column: edge.column,
    typeOnly: edge.typeOnly,
    target: fields.target,
    literalSpecifier: edge.literalSpecifier,
    reexportAll: edge.reexportAll,
  })
}

function reexportElementsAreTypeOnly(declaration: ts.ExportDeclaration): boolean {
  const clause = declaration.exportClause
  return Boolean(
    clause
    && ts.isNamedExports(clause)
    && clause.elements.length > 0
    && clause.elements.every((element) => element.isTypeOnly),
  )
}

function collectExportDeclarationNames(
  declaration: ts.ExportDeclaration,
  exportedNames: Set<string>,
): void {
  const clause = declaration.exportClause
  if (!clause) return
  if (ts.isNamespaceExport(clause)) {
    exportedNames.add(clause.name.text)
    return
  }
  for (const element of clause.elements) {
    exportedNames.add(element.propertyName?.text ?? element.name.text)
    exportedNames.add(element.name.text)
  }
}

function collectExportDeclarationFacts(
  declaration: ts.ExportDeclaration,
  facts: TypeScriptExportFact[],
): void {
  const specifier = declaration.moduleSpecifier
    ? stringLiteralText(declaration.moduleSpecifier) ?? null
    : null
  const clause = declaration.exportClause
  if (!clause) {
    facts.push({
      kind: 'star-reexport',
      exportedName: null,
      sourceName: '*',
      specifier,
      target: specifier,
      typeOnly: declaration.isTypeOnly,
    })
    return
  }
  if (ts.isNamespaceExport(clause)) {
    facts.push({
      kind: 'namespace-reexport',
      exportedName: clause.name.text,
      sourceName: '*',
      specifier,
      target: specifier,
      typeOnly: declaration.isTypeOnly,
    })
    return
  }
  for (const element of clause.elements) {
    facts.push({
      kind: specifier ? 'named-reexport' : 'local',
      exportedName: element.name.text,
      sourceName: element.propertyName?.text ?? element.name.text,
      specifier,
      target: specifier,
      typeOnly: declaration.isTypeOnly || element.isTypeOnly,
    })
  }
}

function collectExportedDeclarationNames(node: ts.Node, exportedNames: Set<string>): void {
  if (node.parent?.kind !== ts.SyntaxKind.SourceFile) return

  if (ts.isExportAssignment(node)) {
    if (!node.isExportEquals) {
      exportedNames.add('default')
      const identifier = transparentExportIdentifier(node.expression)
      if (identifier) exportedNames.add(identifier.text)
    }
    return
  }
  if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) return
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    exportedNames.add('default')
    if (
      (ts.isClassDeclaration(node)
        || ts.isEnumDeclaration(node)
        || ts.isFunctionDeclaration(node)
        || ts.isInterfaceDeclaration(node))
      && node.name
    ) {
      exportedNames.add(node.name.text)
    }
    return
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      collectBindingNames(declaration.name, exportedNames)
    }
    return
  }
  if (
    ts.isClassDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
  ) {
    if (node.name) exportedNames.add(node.name.text)
    return
  }
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
    exportedNames.add(node.name.text)
  }
}

function collectExportedDeclarationFacts(node: ts.Node, facts: TypeScriptExportFact[]): void {
  if (node.parent?.kind !== ts.SyntaxKind.SourceFile) return

  if (ts.isExportAssignment(node)) {
    if (!node.isExportEquals) {
      const identifier = transparentExportIdentifier(node.expression)
      facts.push({
        kind: 'local',
        exportedName: 'default',
        sourceName: identifier?.text ?? 'default',
        specifier: null,
        target: null,
        typeOnly: false,
      })
    }
    return
  }
  if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) return
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    const sourceName = (
      (ts.isClassDeclaration(node)
        || ts.isEnumDeclaration(node)
        || ts.isFunctionDeclaration(node)
        || ts.isInterfaceDeclaration(node))
      && node.name
    ) ? node.name.text : 'default'
    facts.push({
      kind: 'local',
      exportedName: 'default',
      sourceName,
      specifier: null,
      target: null,
      typeOnly: ts.isInterfaceDeclaration(node),
    })
    return
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        const initializerName = declaration.initializer
          ? transparentExportIdentifier(declaration.initializer)?.text
          : undefined
        facts.push(localExportFact(declaration.name.text, initializerName ?? declaration.name.text))
        continue
      }
      const bindingNames = new Set<string>()
      collectBindingNames(declaration.name, bindingNames)
      for (const name of bindingNames) facts.push(localExportFact(name, name))
    }
    return
  }

  const names = new Set<string>()
  if (
    ts.isClassDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isModuleDeclaration(node)
  ) {
    if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text)
  }

  for (const name of names) {
    facts.push(localExportFact(
      name,
      name,
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
    ))
  }
}

function localExportFact(
  exportedName: string,
  sourceName: string,
  typeOnly = false,
): TypeScriptExportFact {
  return {
    kind: 'local',
    exportedName,
    sourceName,
    specifier: null,
    target: null,
    typeOnly,
  }
}

function transparentExportIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  let candidate = expression
  while (
    ts.isParenthesizedExpression(candidate)
    || ts.isAsExpression(candidate)
    || ts.isTypeAssertionExpression(candidate)
    || ts.isSatisfiesExpression(candidate)
    || ts.isNonNullExpression(candidate)
  ) {
    candidate = candidate.expression
  }
  return ts.isIdentifier(candidate) ? candidate : undefined
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text)
    return
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names)
  }
}

function hasModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(
    ts.getModifiers(node)?.some((candidate) => candidate.kind === modifier),
  )
}

function isDynamicImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
}

function stringLiteralText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined
}

function sourceFactError(sourceFile: ts.SourceFile, node: ts.Node, message: string): Error {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return new Error(`${message} at ${sourceFile.fileName}:${location.line + 1}:${location.character + 1}`)
}

function resolveImportTarget(
  importerPath: string,
  specifier: string,
  sourcePaths: ReadonlySet<string>,
): string {
  if (!specifier.startsWith('.')) return specifier

  const unresolvedTarget = normalizePath(`${directoryName(importerPath)}/${specifier}`)
  for (const candidate of resolutionCandidates(unresolvedTarget)) {
    if (sourcePaths.has(candidate)) return candidate
  }
  return unresolvedTarget
}

function resolutionCandidates(target: string): string[] {
  const candidates = [target]
  const extension = fileExtension(target)
  const replacements = JAVASCRIPT_EXTENSION_REPLACEMENTS.get(extension)
  if (replacements) {
    const base = target.slice(0, -extension.length)
    candidates.push(...replacements.map((replacement) => `${base}${replacement}`))
  } else if (!SOURCE_EXTENSIONS.includes(extension as typeof SOURCE_EXTENSIONS[number])) {
    candidates.push(...SOURCE_EXTENSIONS.map((sourceExtension) => `${target}${sourceExtension}`))
  }
  candidates.push(...SOURCE_EXTENSIONS.map((sourceExtension) => `${target}/index${sourceExtension}`))
  return candidates
}

function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot)
}

function directoryName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash)
}

function normalizePath(path: string): string {
  const slashPath = path.replace(/\\/g, '/')
  const prefix = slashPath.startsWith('/') ? '/' : ''
  const segments: string[] = []
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
      else if (!prefix) segments.push(segment)
      continue
    }
    segments.push(segment)
  }
  return `${prefix}${segments.join('/')}` || (prefix || '.')
}

function fileUrlPath(url: URL): string {
  const decodedPath = decodeURIComponent(url.pathname)
  if (url.protocol === 'file:') {
    if (url.hostname) return `//${url.hostname}${decodedPath}`
    return /^\/[a-z]:\//i.test(decodedPath) ? decodedPath.slice(1) : decodedPath
  }

  if ((url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname)) {
    if (decodedPath.startsWith('/@fs/')) return decodedPath.slice('/@fs'.length)
    return normalizePath(`${ts.sys.getCurrentDirectory()}/${decodedPath.replace(/^\/+/, '')}`)
  }

  throw new Error(`Expected a local source URL, received ${url.href}`)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function pathRelativeToRoot(root: string, path: string): string {
  const prefix = root === '/' ? '/' : `${root}/`
  const comparableRoot = ts.sys.useCaseSensitiveFileNames ? prefix : prefix.toLowerCase()
  const comparablePath = ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()
  if (!comparablePath.startsWith(comparableRoot)) {
    throw new Error(`Discovered source is outside TypeScript root: ${path}`)
  }
  return path.slice(prefix.length)
}

function trimTrailingSlash(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '')
}

function trimSlashes(path: string): string {
  return path === '.' ? '' : path.replace(/^\/+|\/+$/g, '')
}
