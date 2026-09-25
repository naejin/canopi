import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildReceipt, createDerivative, processFixture, sha256, withTemporaryDerivative } from './fixture-receipt.mjs'

const run = promisify(execFile)
const script = new URL('./fixture-receipt.mjs', import.meta.url)

function fixture() {
  return {
    version: 7, name: 'PRIVATE DESIGN NAME', description: 'private', layers: [{ name: 'layer', visible: true, locked: false, opacity: 1 }],
    plants: [
      { id: 'alpha', canonical_name: 'Secretus alpha', position: { lon: 13.00001, lat: 22.99998 }, color: '#123456', symbol: 'shrub', locked: false },
      { id: 'beta', canonical_name: 'Secretus beta', position: { lon: 12.99996, lat: 22.99997 }, color: '#abcdef', symbol: 'herb', locked: true },
    ],
    zones: [{ name: 'zone', points: [] }], annotations: [{ id: 'annotation', text: 'private', position: { lon: 13, lat: 23 } }],
    measurement_guides: [{ id: 'measure', start: { lon: 13, lat: 23 }, end: { lon: 13.00001, lat: 22.99999 } }], guides: [{ id: 'guide', axis: 'h', lat: 22.99998 }],
    consortiums: [],
    timeline: [{ id: 'action', targets: [{ kind: 'placed_plant', plant_id: 'beta' }] }],
    budget: [{ description: 'item', target: { kind: 'placed_plant', plant_id: 'alpha' } }],
    groups: [{ id: 'group', members: [{ kind: 'plant', id: 'alpha' }] }],
  }
}

async function withFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'canopi-receipt-test-'))
  const file = join(directory, 'PRIVATE-NAME.canopi')
  await writeFile(file, JSON.stringify(fixture()))
  try { return await callback(file, directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('receipt exposes exact aggregate data and no sensitive values', async () => {
  await withFixture(async file => {
    const bytes = await readFile(file)
    const receipt = await processFixture(file, { 'expected-sha256': sha256(bytes), 'expected-plants': '2' })
    assert.deepEqual(receipt.counts, { plants: 2, zones: 1, annotations: 1, measurementGuides: 1, layers: 1, guides: 1, consortiums: 0, budget: 1 })
    assert.equal(receipt.byteSize, bytes.byteLength)
    assert.equal(receipt.integrity.references.groupsPlant.valid, 1)
    assert.equal(receipt.integrity.references.timelinePlant.valid, 1)
    assert.equal(receipt.integrity.references.budgetPlant.valid, 1)
    assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(receipt).includes('Secretus'), false)
  })
})

test('CLI reports mismatches without path or design content', async () => {
  await withFixture(async file => {
    await assert.rejects(run(process.execPath, [script.pathname, '--file', file, '--expected-plants', '99']), error => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /expected plants count mismatch/)
      assert.equal(error.stderr.includes(file), false)
      assert.equal(error.stderr.includes('PRIVATE'), false)
      return true
    })
  })
})

test('source bytes remain unchanged and derivative has deterministic unique IDs', async () => {
  await withFixture(async file => {
    const before = sha256(await readFile(file))
    const derivative = createDerivative(fixture(), 'dense')
    const repeated = createDerivative(fixture(), 'dense')
    assert.equal(derivative.plants.length, 10000)
    assert.equal(new Set(derivative.plants.map(plant => plant.id)).size, 10000)
    assert.deepEqual(derivative, repeated)
    assert.equal(sha256(await readFile(file)), before)
    assert.deepEqual(derivative.groups[0].members, [{ kind: 'plant', id: 'synthetic-plant-00001' }])
    assert.deepEqual(derivative.timeline[0].targets, [{ kind: 'placed_plant', plant_id: 'synthetic-plant-00002' }])
    assert.deepEqual(derivative.budget[0].target, { kind: 'placed_plant', plant_id: 'synthetic-plant-00001' })
  })
})

test('dense and dispersed layouts are distinct and preserve plant fields', () => {
  const dense = createDerivative(fixture(), 'dense')
  const dispersed = createDerivative(fixture(), 'dispersed')
  for (const derivative of [dense, dispersed]) {
    const receipt = buildReceipt(derivative, Buffer.from(JSON.stringify(derivative)))
    assert.equal(receipt.counts.plants, 10000)
    assert.equal(receipt.integrity.uniqueNonemptyPlantIds, 10000)
    assert.equal(receipt.integrity.references.total, receipt.integrity.references.valid)
  }
  assert.notDeepEqual(dense.plants[101].position, dispersed.plants[101].position)
  assert.equal(dense.plants[1].canonical_name, 'Secretus beta')
  assert.equal(dense.plants[1].color, '#abcdef')
  assert.equal(dense.plants[1].symbol, 'herb')
})

test('derivative receipt stays aggregate-only and its temporary directory is removed', async () => {
  await withFixture(async file => {
    const { stdout } = await run(process.execPath, [script.pathname, '--file', file, '--derivative', 'dispersed'])
    const receipt = JSON.parse(stdout)
    assert.equal(receipt.syntheticDerivative.layout, 'dispersed')
    assert.equal(receipt.syntheticDerivative.plants, 10000)
    assert.equal(JSON.stringify(receipt).includes('path'), false)
    assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false)
  })
})

test('temporary derivative is removed after success and the source hash remains unchanged', async () => {
  await withFixture(async file => {
    const before = sha256(await readFile(file))
    let derivativeFile = ''
    const result = await withTemporaryDerivative(file, 'dense', {}, async ({ file: temporaryFile, receipt }) => {
      derivativeFile = temporaryFile
      assert.equal(receipt.syntheticDerivative.plants, 10000)
      return 'complete'
    })
    assert.equal(result, 'complete')
    await assert.rejects(access(derivativeFile))
    assert.equal(sha256(await readFile(file)), before)
  })
})

test('temporary derivative is removed after a callback failure', async () => {
  await withFixture(async file => {
    const before = sha256(await readFile(file))
    let derivativeFile = ''
    await assert.rejects(withTemporaryDerivative(file, 'dispersed', {}, async ({ file: temporaryFile }) => {
      derivativeFile = temporaryFile
      throw new Error('intentional callback failure')
    }), /intentional callback failure/)
    await assert.rejects(access(derivativeFile))
    assert.equal(sha256(await readFile(file)), before)
  })
})

test('derivative refuses dangling group plant references', () => {
  const bad = fixture()
  bad.groups[0].members[0].id = 'missing'
  assert.throws(() => createDerivative(bad), /dangling plant references/)
})

test('derivative refuses empty and oversized source fixtures', () => {
  const empty = fixture()
  empty.plants = []
  assert.throws(() => createDerivative(empty), /at least one plant/)
  const oversized = fixture()
  oversized.plants = Array.from({ length: 10001 }, (_, index) => ({
    ...oversized.plants[index % 2],
    id: `source-${index}`,
  }))
  assert.throws(() => createDerivative(oversized), /at most 10000 source plants/)
})

test('CLI errors redact missing input path', async () => {
  const privatePath = join(tmpdir(), 'PRIVATE-MISSING-NAME.canopi')
  await assert.rejects(run(process.execPath, [script.pathname, '--file', privatePath]), error => {
    assert.equal(error.code, 1)
    assert.equal(error.stderr.includes(privatePath), false)
    assert.match(error.stderr, /cannot read input fixture/)
    return true
  })
})
