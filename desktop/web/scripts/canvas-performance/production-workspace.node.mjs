import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import {
  FAILURE_CODES,
  classifyCapacityEvidence,
  percentile,
  sanitizeRunnerError,
} from './production-workspace.mjs'

const run = promisify(execFile)
const script = new URL('./production-workspace.mjs', import.meta.url)

test('percentiles and fixed capacity thresholds classify deterministically', () => {
  assert.equal(percentile([30, 10, 20], 0.5), 20)
  assert.equal(percentile([30, 10, 20], 0.95), 30)
  const accepted = classifyCapacityEvidence({
    frameIntervalsMs: [16, 16.7, 17],
    inputToSecondRafMs: [20, 30, 40],
  })
  assert.deepEqual(accepted, {
    frameOpportunityProxy: { status: 'fail', referenceMs: 16.7, p95Ms: 17 },
    inputToSecondRafProxy: { status: 'pass', referenceMs: 50, p95Ms: 40 },
    sustainedFrameOpportunityStalls: { status: 'pass', thresholdMs: 100, count: 0, sustained: false },
    proxyOverall: 'fail',
    nativeQualification: 'unavailable',
  })
  const failed = classifyCapacityEvidence({
    frameIntervalsMs: [16.7, 20],
    inputToSecondRafMs: [49, 51],
  })
  assert.equal(failed.frameOpportunityProxy.status, 'fail')
  assert.equal(failed.inputToSecondRafProxy.status, 'fail')
  assert.equal(failed.proxyOverall, 'fail')
  assert.equal(failed.nativeQualification, 'unavailable')
})

test('a single long frame is reported but is not a sustained stall', () => {
  const result = classifyCapacityEvidence({
    frameIntervalsMs: [16, 150, 16],
    inputToSecondRafMs: [10],
  })
  assert.equal(result.sustainedFrameOpportunityStalls.count, 1)
  assert.equal(result.sustainedFrameOpportunityStalls.sustained, false)
  assert.equal(result.sustainedFrameOpportunityStalls.status, 'pass')
})

test('runner errors omit private paths and payload fragments', () => {
  const privatePath = '/home/person/PRIVATE-DESIGN.canopi'
  const error = sanitizeRunnerError({ code: 'interaction', message: `failed ${privatePath} with {\"name\":\"PRIVATE\"}` })
  assert.equal(error.includes(privatePath), false)
  assert.equal(error.includes('PRIVATE'), false)
  assert.equal(error, 'production workspace capacity run failed [interaction]')
  assert.equal(sanitizeRunnerError({ code: 'not-a-code' }), 'production workspace capacity run failed [unknown]')
  assert.equal(sanitizeRunnerError({ code: 'interaction', cleanupCode: 'listener-cleanup' }), 'production workspace capacity run failed [interaction; cleanup=listener-cleanup]')
  assert.equal(FAILURE_CODES.includes('browser-launch'), true)
  assert.equal(FAILURE_CODES.includes('source-recheck'), true)
})

test('runner CLI redacts a private fixture location before loading a browser', async () => {
  const privatePath = '/tmp/PRIVATE-CAPACITY-DESIGN.canopi'
  await assert.rejects(run(process.execPath, [script.pathname, '--file', privatePath]), (error) => {
    assert.equal(error.code, 1)
    assert.equal(error.stderr.includes(privatePath), false)
    assert.equal(error.stderr.includes('PRIVATE'), false)
    assert.equal(error.stderr.trim(), 'production workspace capacity run failed [source-recheck]')
    return true
  })
})

test('browser callbacks compare values inside their page evaluation context', async () => {
  const source = await readFile(script, 'utf8')
  assert.equal(source.includes('sameViewport'), false)
  assert.equal(source.includes('samePoint'), false)
  assert.match(source, /collectNavigationFrames/)
  assert.match(source, /alternating synthetic wheel events/)
  assert.match(source, /groupedPlantIds/)
  assert.match(source, /MAX_POINTER_TARGET_CANDIDATES/)
  assert.match(source, /no pointer-selectable editable plant candidate/)
  assert.match(source, /status: 'fail'/)
})

test('actual harness listener ledger distinguishes capture and DOM deduplication', async () => {
  const source = await readFile(script, 'utf8')
  const installHarnessInstrumentation = Function(`return (${extractFunction(source, 'installHarnessInstrumentation')})`)()
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCanvas = globalThis.HTMLCanvasElement
  const scope = new EventTarget()
  globalThis.window = new EventTarget()
  globalThis.document = new EventTarget()
  globalThis.HTMLCanvasElement = class HTMLCanvasElement extends EventTarget {}
  class FakeMap {
    addLayer() {}
    on() {}
    off() {}
    remove() {}
    getLayersOrder() { return ['basemap-background', 'canopi-shared-scene'] }
  }
  const instrumentation = installHarnessInstrumentation({ Map: FakeMap }, scope)
  const map = new FakeMap()
  map.addLayer()
  map.remove()
  const listener = () => {}
  try {
    scope.addEventListener('pointerdown', listener, { capture: true })
    scope.addEventListener('pointerdown', listener, { capture: true })
    scope.removeEventListener('pointerdown', listener)
    assert.equal(instrumentation.assertNoActiveListeners().status, 'fail')
    scope.removeEventListener('pointerdown', listener, { capture: true })
    assert.equal(instrumentation.assertNoActiveListeners().status, 'pass')
  } finally {
    instrumentation.restore()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.HTMLCanvasElement = originalCanvas
  }
})

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1)
  const body = source.indexOf('{', start)
  let depth = 0
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated ${name}`)
}
