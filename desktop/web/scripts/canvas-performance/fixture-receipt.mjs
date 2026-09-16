#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COUNT_KEYS = ['plants', 'zones', 'annotations', 'measurementGuides', 'layers', 'guides', 'consortiums', 'budget']

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function arrayField(document, key) {
  if (!Array.isArray(document[key])) throw new Error(`invalid ${key} array`)
  return document[key]
}

function validateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('root must be an object')
  if (!Number.isInteger(document.version) || document.version < 0) throw new Error('invalid numeric version')
  for (const key of ['plants', 'zones', 'annotations', 'measurement_guides', 'layers', 'consortiums', 'budget']) arrayField(document, key)
  for (const key of ['groups', 'guides', 'timeline']) if (document[key] !== undefined) arrayField(document, key)
  const plants = document.plants
  const ids = new Set()
  for (const plant of plants) {
    if (!plant || typeof plant !== 'object' || typeof plant.id !== 'string' || !plant.id) throw new Error('plant has invalid id')
    if (ids.has(plant.id)) throw new Error('plant ids are not unique')
    ids.add(plant.id)
    if (!plant.position || typeof plant.position !== 'object' || !Number.isFinite(plant.position.x) || !Number.isFinite(plant.position.y)) throw new Error('plant has invalid position')
  }
  const references = { groupsPlant: { total: 0, valid: 0 }, timelinePlant: { total: 0, valid: 0 }, budgetPlant: { total: 0, valid: 0 } }
  const groups = document.groups ?? []
  for (const group of groups) {
    if (!group || !Array.isArray(group.members)) throw new Error('group has invalid members')
    for (const member of group.members) {
      if (member?.kind === 'plant') {
        references.groupsPlant.total++
        if (ids.has(member.id)) references.groupsPlant.valid++
      }
    }
  }
  const inspectTargets = (items, result) => {
    for (const item of items) for (const target of item?.targets ?? []) {
      if (target?.kind === 'placed_plant') {
        result.total++
        if (ids.has(target.plant_id)) result.valid++
      }
    }
  }
  inspectTargets(document.timeline ?? [], references.timelinePlant)
  for (const item of document.budget) {
    if (item?.target?.kind === 'placed_plant') {
      references.budgetPlant.total++
      if (ids.has(item.target.plant_id)) references.budgetPlant.valid++
    }
  }
  const totalRefs = Object.values(references).reduce((sum, value) => sum + value.total, 0)
  const validRefs = Object.values(references).reduce((sum, value) => sum + value.valid, 0)
  return { ids, references: { ...references, total: totalRefs, valid: validRefs } }
}

export function buildReceipt(document, bytes) {
  const { ids, references } = validateDocument(document)
  const arrays = {
    plants: document.plants,
    zones: document.zones,
    annotations: document.annotations,
    measurementGuides: document.measurement_guides,
    layers: document.layers,
    guides: document.guides ?? [],
    consortiums: document.consortiums,
    budget: document.budget,
  }
  return {
    sha256: sha256(bytes),
    byteSize: bytes.byteLength,
    formatVersion: document.version,
    counts: Object.fromEntries(Object.entries(arrays).map(([key, value]) => [key, value.length])),
    integrity: {
      uniqueNonemptyPlantIds: ids.size,
      references,
    },
  }
}

function offsetFor(index, mode) {
  if (mode === 'dense') return { x: (index % 100) * 0.25, y: Math.floor(index / 100) * 0.25 }
  return { x: (index % 100) * 4, y: Math.floor(index / 100) * 4 }
}

export function createDerivative(document, mode = 'dense') {
  if (!['dense', 'dispersed'].includes(mode)) throw new Error('layout must be dense or dispersed')
  const { ids, references } = validateDocument(document)
  if (!document.plants.length) throw new Error('derivative requires at least one plant')
  if (document.plants.length > 10000) throw new Error('derivative supports at most 10000 source plants')
  if (references.valid !== references.total) throw new Error('input has dangling plant references')
  const firstCopyIds = new Map()
  const plants = Array.from({ length: 10000 }, (_, index) => {
    const source = document.plants[index % document.plants.length]
    const id = `synthetic-plant-${String(index + 1).padStart(5, '0')}`
    if (index < document.plants.length) firstCopyIds.set(source.id, id)
    const offset = offsetFor(index, mode)
    return { ...source, id, position: { x: source.position.x + offset.x, y: source.position.y + offset.y } }
  })
  const derivative = structuredClone(document)
  derivative.plants = plants
  derivative.groups = (document.groups ?? []).map(group => ({
    ...group,
    members: group.members.map(member => member.kind === 'plant' ? { ...member, id: firstCopyIds.get(member.id) ?? member.id } : { ...member }),
  }))
  const remapTargets = items => items.map(item => item.targets === undefined ? { ...item } : ({
    ...item,
    targets: item.targets.map(target => target.kind === 'placed_plant'
      ? { ...target, plant_id: firstCopyIds.get(target.plant_id) ?? target.plant_id }
      : { ...target }),
  }))
  derivative.timeline = remapTargets(document.timeline ?? [])
  derivative.budget = document.budget.map(item => ({
    ...item,
    target: item.target?.kind === 'placed_plant'
      ? { ...item.target, plant_id: firstCopyIds.get(item.target.plant_id) ?? item.target.plant_id }
      : structuredClone(item.target),
  }))
  validateDocument(derivative)
  // The source document is immutable by construction; this check also guards future edits.
  if (ids.size !== document.plants.length) throw new Error('plant ids are not unique')
  return derivative
}

function usage() {
  return 'usage: fixture-receipt.mjs --file <path> [--expected-sha256 <hex>] [--expected-<count> <n>] [--derivative dense|dispersed]'
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(usage())
    const key = token.slice(2)
    if (key === 'help') return { help: true }
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`)
    args[key] = value
  }
  return args
}

export async function processFixture(file, options = {}) {
  if (options.derivative) {
    let receipt
    await withTemporaryDerivative(file, options.derivative, options, async (temporary) => {
      receipt = temporary.receipt
    })
    return receipt
  }
  const source = await readVerifiedFixture(file, options)
  await assertSourceUnchanged(file, source.sha256)
  return source.receipt
}

/**
 * Creates a deterministic capacity derivative only for the duration of a
 * callback. The callback receives its private location, never a public
 * receipt field. Both callback outcomes recheck the source and remove the
 * temporary directory before returning.
 */
export async function withTemporaryDerivative(file, mode, options, callback) {
  const source = await readVerifiedFixture(file, options)
  const derivative = createDerivative(source.document, mode)
  const directory = await mkdtemp(join(tmpdir(), 'canopi-fixture-'))
  const derivativeFile = join(directory, 'synthetic-derivative.canopi')
  const receipt = {
    ...source.receipt,
    syntheticDerivative: {
      layout: mode,
      plants: derivative.plants.length,
      integrity: buildReceipt(derivative, Buffer.from(JSON.stringify(derivative))).integrity,
    },
  }
  let result
  let callbackFailure
  try {
    await writeFile(derivativeFile, JSON.stringify(derivative, null, 2) + '\n', { flag: 'wx' })
    result = await callback({ file: derivativeFile, receipt })
  } catch (error) {
    callbackFailure = error
  }
  let cleanupFailure
  try {
    await rm(directory, { recursive: true, force: true })
  } catch (error) {
    cleanupFailure = error
  }
  let sourceFailure
  try {
    await assertSourceUnchanged(file, source.sha256)
  } catch (error) {
    sourceFailure = error
  }
  if (sourceFailure) throw sourceFailure
  if (cleanupFailure) throw new Error('cannot clean temporary fixture derivative', { cause: cleanupFailure })
  if (callbackFailure) throw callbackFailure
  return result
}

async function readVerifiedFixture(file, options) {
  let bytes
  try { bytes = await readFile(file) } catch { throw new Error('cannot read input fixture') }
  let document
  try { document = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('input is not valid JSON') }
  const receipt = buildReceipt(document, bytes)
  for (const key of COUNT_KEYS) {
    const expected = options[`expected-${key}`] ?? options[`expected-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`]
    if (expected !== undefined && (!/^\d+$/.test(expected) || Number(expected) !== receipt.counts[key])) throw new Error(`expected ${key} count mismatch`)
  }
  if (options['expected-sha256'] !== undefined && options['expected-sha256'] !== receipt.sha256) throw new Error('expected SHA-256 mismatch')
  return { document, receipt, sha256: receipt.sha256 }
}

async function assertSourceUnchanged(file, expectedSha256) {
  let bytes
  try { bytes = await readFile(file) } catch { throw new Error('cannot recheck input fixture') }
  if (sha256(bytes) !== expectedSha256) throw new Error('input fixture changed during processing')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(usage())
  if (!args.file) throw new Error('missing --file')
  const receipt = await processFixture(args.file, args)
  console.log(JSON.stringify(receipt, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(`fixture receipt: ${error.message}`); process.exitCode = 1 })
}
