// This is deliberately a focused interpreter for the generator-enforced Schemars
// subset, not a general JSON Schema implementation. Nested unknown fields are
// discarded like serde; the root schema explicitly preserves flattened extras.
interface JsonSchemaNode {
  readonly $ref?: string
  readonly type?: string | readonly string[]
  readonly format?: string
  readonly minimum?: number
  readonly default?: unknown
  readonly const?: unknown
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>
  readonly required?: readonly string[]
  readonly items?: JsonSchemaNode
  readonly additionalProperties?: boolean | JsonSchemaNode
  readonly anyOf?: readonly JsonSchemaNode[]
  readonly oneOf?: readonly JsonSchemaNode[]
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>
  readonly $schema?: string
  readonly title?: string
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  '$defs',
  '$ref',
  '$schema',
  'additionalProperties',
  'anyOf',
  'const',
  'default',
  'enum',
  'format',
  'items',
  'minimum',
  'oneOf',
  'properties',
  'required',
  'title',
  'type',
])
const SUPPORTED_SCHEMA_FORMATS = new Set(['double', 'float', 'int32', 'uint32'])

const UINT32_MAX = 4_294_967_295
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647
const FLOAT32_MAX = 3.4028234663852886e38

let checkedSchema: JsonSchemaNode | null = null

export function decodeCanopiFileSchema(value: unknown, generatedSchema: unknown): unknown {
  const schema = generatedSchema as JsonSchemaNode
  if (checkedSchema !== schema) {
    assertSupportedSchema(schema, '$schema', new Set())
    checkedSchema = schema
  }
  return decodeSchemaValue(value, schema, '$', schema)
}

function decodeSchemaValue(
  value: unknown,
  schema: JsonSchemaNode,
  path: string,
  root: JsonSchemaNode,
): unknown {
  if (schema.$ref) {
    return decodeSchemaValue(value, resolveReference(schema.$ref, root), path, root)
  }
  if (schema.anyOf) return decodeAlternatives(value, schema.anyOf, path, root)
  if (schema.oneOf) return decodeOneOf(value, schema.oneOf, path, root)

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !Object.is(value, schema.const)) {
    fail(path, `expected ${formatLiteral(schema.const)}`)
  }
  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) {
    fail(path, `expected one of ${schema.enum.map(formatLiteral).join(', ')}`)
  }

  const types = schema.type === undefined
    ? []
    : Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    fail(path, expectedTypes(types))
  }

  if (types.includes('number') || types.includes('integer')) {
    validateNumber(value, schema, path, types.includes('integer'))
    if (schema.format === 'float' && typeof value === 'number') return Math.fround(value)
  }
  if (types.includes('array') && Array.isArray(value)) {
    const itemSchema = schema.items
    return itemSchema
      ? value.map((item, index) => decodeSchemaValue(item, itemSchema, `${path}[${index}]`, root))
      : value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`))
  }
  if (types.includes('object') && isRecord(value)) {
    return decodeObject(value, schema, path, root)
  }
  return value
}

function decodeObject(
  value: Record<string, unknown>,
  schema: JsonSchemaNode,
  path: string,
  root: JsonSchemaNode,
): Record<string, unknown> {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const output: Record<string, unknown> = {}

  for (const [key, propertySchema] of Object.entries(properties)) {
    const propertyPath = pathForProperty(path, key)
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      defineJsonProperty(
        output,
        key,
        decodeSchemaValue(value[key], propertySchema, propertyPath, root),
      )
      continue
    }
    if (Object.prototype.hasOwnProperty.call(propertySchema, 'default')) {
      defineJsonProperty(
        output,
        key,
        decodeSchemaValue(
          cloneJsonValue(propertySchema.default, propertyPath),
          propertySchema,
          propertyPath,
          root,
        ),
      )
      continue
    }
    if (required.has(key)) fail(propertyPath, 'missing required value')
    if (schemaAllowsNull(propertySchema, root)) defineJsonProperty(output, key, null)
  }

  for (const [key, entry] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) continue
    const propertyPath = pathForProperty(path, key)
    if (schema.additionalProperties === true) {
      defineJsonProperty(output, key, cloneJsonValue(entry, propertyPath))
    } else if (isSchemaNode(schema.additionalProperties)) {
      defineJsonProperty(
        output,
        key,
        decodeSchemaValue(entry, schema.additionalProperties, propertyPath, root),
      )
    }
  }

  return output
}

function decodeAlternatives(
  value: unknown,
  alternatives: readonly JsonSchemaNode[],
  path: string,
  root: JsonSchemaNode,
): unknown {
  const failures: Error[] = []
  for (const alternative of alternatives) {
    try {
      return decodeSchemaValue(value, alternative, path, root)
    } catch (error) {
      failures.push(asError(error))
    }
  }
  throw deepestFailure(failures, path)
}

function decodeOneOf(
  value: unknown,
  alternatives: readonly JsonSchemaNode[],
  path: string,
  root: JsonSchemaNode,
): unknown {
  if (isRecord(value)) {
    const discriminated = alternatives
      .map((alternative) => ({
        alternative,
        kind: alternative.properties?.kind?.const,
      }))
      .filter((entry): entry is { alternative: JsonSchemaNode; kind: unknown } => (
        entry.kind !== undefined
      ))
    if (discriminated.length === alternatives.length) {
      const selected = discriminated.find((entry) => Object.is(entry.kind, value.kind))
      if (!selected) {
        fail(
          pathForProperty(path, 'kind'),
          `expected one of ${discriminated.map((entry) => formatLiteral(entry.kind)).join(', ')}`,
        )
      }
      return decodeSchemaValue(value, selected.alternative, path, root)
    }
  }
  return decodeAlternatives(value, alternatives, path, root)
}

function validateNumber(
  value: unknown,
  schema: JsonSchemaNode,
  path: string,
  integer: boolean,
): void {
  if (value === null && typeList(schema).includes('null')) return
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, integer ? 'expected an integer' : 'expected a finite number')
  }
  if (integer && !Number.isInteger(value)) fail(path, 'expected an integer')
  if (schema.minimum !== undefined && value < schema.minimum) {
    fail(path, `expected a number greater than or equal to ${schema.minimum}`)
  }
  switch (schema.format) {
    case 'uint32':
      if (value > UINT32_MAX) fail(path, 'expected an unsigned 32-bit integer')
      break
    case 'int32':
      if (value < INT32_MIN || value > INT32_MAX) fail(path, 'expected a signed 32-bit integer')
      break
    case 'float':
      if (Math.abs(value) > FLOAT32_MAX) fail(path, 'expected a finite 32-bit number')
      break
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null
    case 'array': return Array.isArray(value)
    case 'object': return isRecord(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    default: throw new Error(`Unsupported generated Canopi schema type: ${type}`)
  }
}

function expectedTypes(types: readonly string[]): string {
  if (types.length === 1 && types[0] === 'number') return 'expected a finite number'
  if (types.length === 1 && types[0] === 'integer') return 'expected an integer'
  const descriptions = types.map((type) => {
    switch (type) {
      case 'null': return 'null'
      case 'array': return 'an array'
      case 'object': return 'an object'
      case 'number': return 'a finite number'
      case 'integer': return 'an integer'
      case 'string': return 'a string'
      case 'boolean': return 'a boolean'
      default: return type
    }
  })
  return `expected ${descriptions.join(' or ')}`
}

function schemaAllowsNull(schema: JsonSchemaNode, root: JsonSchemaNode): boolean {
  if (schema.$ref) return schemaAllowsNull(resolveReference(schema.$ref, root), root)
  if (typeList(schema).includes('null')) return true
  return schema.anyOf?.some((entry) => schemaAllowsNull(entry, root)) ?? false
}

function typeList(schema: JsonSchemaNode): readonly string[] {
  if (schema.type === undefined) return []
  return typeof schema.type === 'string' ? [schema.type] : schema.type
}

function resolveReference(reference: string, root: JsonSchemaNode): JsonSchemaNode {
  if (!reference.startsWith('#/')) {
    throw new Error(`Unsupported generated Canopi schema reference: ${reference}`)
  }
  let current: unknown = root
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Broken generated Canopi schema reference: ${reference}`)
    }
    current = current[segment]
  }
  if (!isSchemaNode(current)) {
    throw new Error(`Broken generated Canopi schema reference: ${reference}`)
  }
  return current
}

function cloneJsonValue(value: unknown, path: string, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'expected a finite number')
    return value
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail(path, 'expected an acyclic JSON value')
    ancestors.add(value)
    const cloned = value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, ancestors))
    ancestors.delete(value)
    return cloned
  }
  if (!isRecord(value) || !isPlainRecord(value)) fail(path, 'expected a JSON value')
  if (ancestors.has(value)) fail(path, 'expected an acyclic JSON value')
  ancestors.add(value)
  const cloned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    defineJsonProperty(cloned, key, cloneJsonValue(entry, pathForProperty(path, key), ancestors))
  }
  ancestors.delete(value)
  return cloned
}

function defineJsonProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function assertSupportedSchema(
  schema: JsonSchemaNode,
  path: string,
  visited: Set<JsonSchemaNode>,
): void {
  if (visited.has(schema)) return
  visited.add(schema)
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`${path}: unsupported generated Canopi schema keyword ${key}`)
    }
  }
  if (schema.format && !SUPPORTED_SCHEMA_FORMATS.has(schema.format)) {
    throw new Error(`${path}: unsupported generated Canopi schema format ${schema.format}`)
  }
  for (const [key, child] of Object.entries(schema.$defs ?? {})) {
    assertSupportedSchema(child, `${path}.$defs.${key}`, visited)
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    assertSupportedSchema(child, `${path}.properties.${key}`, visited)
  }
  if (schema.items) assertSupportedSchema(schema.items, `${path}.items`, visited)
  if (isSchemaNode(schema.additionalProperties)) {
    assertSupportedSchema(schema.additionalProperties, `${path}.additionalProperties`, visited)
  }
  schema.anyOf?.forEach((child, index) => {
    assertSupportedSchema(child, `${path}.anyOf[${index}]`, visited)
  })
  schema.oneOf?.forEach((child, index) => {
    assertSupportedSchema(child, `${path}.oneOf[${index}]`, visited)
  })
}

function deepestFailure(failures: readonly Error[], path: string): Error {
  return failures.reduce((deepest, candidate) => (
    errorPathLength(candidate) > errorPathLength(deepest) ? candidate : deepest
  ), failures[0] ?? new Error(`${path}: value does not match the Canopi Design contract`))
}

function errorPathLength(error: Error): number {
  return error.message.split(':', 1)[0]?.length ?? 0
}

function pathForProperty(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function formatLiteral(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

function isSchemaNode(value: unknown): value is JsonSchemaNode {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: Record<string, unknown>): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}
