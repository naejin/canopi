/**
 * NC1-NC2 acceptance — discrete counters and their true comparison operands.
 *
 * The three numeric counters (validated windows `T`, bytes served `B`, requests `R`)
 * count discrete things. Every case starts from the coherent control, perturbs one
 * counter or one operand pair, and asserts the target assertion, the requirement, an
 * identifying reason, the retained gaps, the unaffected requirements and the exit
 * class. The expectations come from the counter units and C1/C8, not from the checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
type Reports = globalThis.Record<string, Rec>;

const CONTRACT = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;

/** Delete a key so the report genuinely does not record it. */
function omit(record: Rec, key: string): Rec {
  const copy: Rec = { ...record };
  delete copy[key];
  return copy;
}

interface Setup {
  /** Replacements applied to the q2 report body. */
  readonly q2?: Rec;
  /** Ledger keys to remove after the replacements. */
  readonly omitLedger?: readonly string[];
  /** Top-level q2 keys to remove, for a genuinely absent counter. */
  readonly omit?: readonly string[];
  readonly outName?: string;
}

function decide(root: TempRoot, options: Setup = {}) {
  const reports = roleReports();
  const q2 = reports['q2']!;
  const override = options.q2 ?? {};
  // A replacement ledger is the base, so omitting a key exercises the case it names.
  const base = isRecord(override['serverLedger'])
    ? override['serverLedger']
    : (q2['serverLedger'] as Rec);
  let ledger: Rec = { ...base };
  for (const key of options.omitLedger ?? []) ledger = omit(ledger, key);
  let body: Rec = { ...q2, ...override, serverLedger: ledger };
  for (const key of options.omit ?? []) body = omit(body, key);
  reports['q2'] = body;
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const request = root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
  return runCli(request, join(root.path, options.outName ?? 'decision.json'));
}

function requirementState(result: ReturnType<typeof runCli>, id: string): {
  readonly verdict: string | undefined;
  readonly assertions: globalThis.Record<string, string>;
  readonly reasons: string;
} {
  const found = (result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: globalThis.Record<string, string>; reasons: string[] }[]
    | undefined)?.find((entry) => entry.id === id);
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
  };
}

const LEDGER = 'transport-ledger-corroborates-bytes';
const WINDOW_BOUND = 'window-size-within-contract-limit';
const TRANSPORT = 'reads-over-proposed-local-transport';

// --------------------------------------------------------------------------
// NC1 — the counters are discrete
// --------------------------------------------------------------------------

test('NC1: a fractional validated-window count fails instead of passing', () => {
  const root = new TempRoot();
  try {
    // The ledger is adjusted so only the tested-window counter is at fault.
    const result = decide(root, { q2: { testedWindows: 0.5 }, omitLedger: ['fixtureRequests'] });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions[TRANSPORT], 'fail');
    assert.match(current.reasons, /testedWindows=0\.5/);
    assert.match(current.reasons, /not a whole non-negative/);
    // The unrelated missing counter is still a gap, and the window bound is intact.
    assert.match(current.reasons, /does not record its request count/);
    assert.equal(current.assertions[WINDOW_BOUND], 'pass');
  } finally {
    root.cleanup();
  }
});

test('NC1: fractional bytes and fractional requests fail with the field named', () => {
  const cases: readonly (readonly [string, Rec])[] = [
    ['fixtureBytesServed', { serverLedger: { fixtureBytesServed: 0.5 } }],
    ['fixtureRequests', { serverLedger: { fixtureRequests: 0.5 } }],
  ];
  for (const [field, q2] of cases) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2 });
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(current.verdict, 'fail', `${field}: ${current.reasons}`);
      assert.equal(current.assertions[LEDGER], 'fail', `${field}: ${current.reasons}`);
      assert.match(current.reasons, new RegExp(`${field}=0\\.5`), field);
      assert.match(current.reasons, /not a whole non-negative/, field);
    } finally {
      root.cleanup();
    }
  }
});

test('NC1: null, strings, booleans and containers are unusable counters', () => {
  const values: readonly [string, unknown][] = [
    ['null', null],
    ['string', '9'],
    ['numeric string', '0.5'],
    ['boolean', true],
    ['list', [9]],
    ['object', { value: 9 }],
    ['negative fraction', -0.5],
  ];
  for (const [label, value] of values) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2: { serverLedger: { fixtureRequests: value } } });
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(current.verdict, 'fail', `${label}: ${current.reasons}`);
      assert.equal(current.assertions[LEDGER], 'fail', `${label}: ${current.reasons}`);
      assert.match(current.reasons, /fixtureRequests=/, label);
      assert.match(current.reasons, /not a whole non-negative|not a possible/, label);
    } finally {
      root.cleanup();
    }
  }
});

test('NC1: zero is a valid counter value and the coherent control still passes', () => {
  const root = new TempRoot();
  try {
    // Zero bytes with zero requests and zero validated windows: consistent counters,
    // even though the transport assertion separately reports that no window was read.
    const result = decide(root, {
      q2: { testedWindows: 0, serverLedger: { fixtureBytesServed: 0, fixtureRequests: 0 } },
    });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.assertions[LEDGER], 'pass', current.reasons);
    assert.equal(current.assertions[TRANSPORT], 'fail', current.reasons);
    assert.match(current.reasons, /validated no window/);
  } finally {
    root.cleanup();
  }

  const control = new TempRoot();
  try {
    const current = requirementState(decide(control), 'Q-LOCAL-1');
    assert.equal(current.verdict, 'pass', current.reasons);
    for (const verdict of Object.values(current.assertions)) assert.equal(verdict, 'pass');
  } finally {
    control.cleanup();
  }
});

// --------------------------------------------------------------------------
// NC2 — each relationship uses only its own operands
// --------------------------------------------------------------------------

test('NC2: zero bytes with validated windows fails even when the request count is absent', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, {
      q2: { serverLedger: { fixtureBytesServed: 0 } },
      omitLedger: ['fixtureRequests'],
    });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions[LEDGER], 'fail');
    assert.match(current.reasons, /validates 9 window\(s\) but its transport ledger records 0 byte\(s\)/);
    assert.match(current.reasons, /does not record its request count/);
  } finally {
    root.cleanup();
  }
});

test('NC2: zero requests with validated windows fails even when the byte count is absent', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, {
      q2: { serverLedger: { fixtureRequests: 0 } },
      omitLedger: ['fixtureBytesServed'],
    });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions[LEDGER], 'fail');
    assert.match(current.reasons, /validates 9 window\(s\) but its transport ledger records 0 request\(s\)/);
    assert.match(current.reasons, /does not record its byte count/);
    // The zero-byte relationship is undecidable with its operand absent, so it gaps
    // rather than inventing a second failure.
    assert.doesNotMatch(current.reasons, /records 0 byte\(s\)/);
  } finally {
    root.cleanup();
  }
});

test('NC2: zero validated windows contradict recorded activity, one operand at a time', () => {
  const cases: readonly (readonly [string, Rec, readonly string[], RegExp])[] = [
    [
      'bytes with no request count',
      { testedWindows: 0, serverLedger: { fixtureBytesServed: 4096 } },
      ['fixtureRequests'],
      /records 4096 byte\(s\) although no window was validated/,
    ],
    [
      'requests with no byte count',
      { testedWindows: 0, serverLedger: { fixtureRequests: 12 } },
      ['fixtureBytesServed'],
      /records 12 request\(s\) although no window was validated/,
    ],
  ];
  for (const [label, q2, omitLedger, reason] of cases) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2, omitLedger });
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(current.verdict, 'fail', `${label}: ${current.reasons}`);
      assert.equal(current.assertions[LEDGER], 'fail', `${label}: ${current.reasons}`);
      assert.match(current.reasons, reason, label);
      assert.match(current.reasons, /does not record its/, label);
    } finally {
      root.cleanup();
    }
  }
});

test('NC2: positive counters with one counter absent stay inconclusive, not failed', () => {
  const cases: readonly (readonly [string, Rec, readonly string[]])[] = [
    ['requests absent', { serverLedger: { fixtureBytesServed: 4_194_304 } }, ['fixtureRequests']],
    ['bytes absent', { serverLedger: { fixtureRequests: 12 } }, ['fixtureBytesServed']],
    [
      'window count absent',
      { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 12 } },
      ['testedWindows'],
    ],
  ];
  for (const [label, q2, omit] of cases) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2, omit });
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(current.assertions[LEDGER], 'inconclusive', `${label}: ${current.reasons}`);
      assert.notEqual(current.verdict, 'pass', label);
      assert.match(current.reasons, /does not record its/, label);
    } finally {
      root.cleanup();
    }
  }
});

test('NC2: a malformed counter never participates in a comparison', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, {
      q2: { serverLedger: { fixtureBytesServed: 'many' } },
      omitLedger: ['fixtureRequests'],
    });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /fixtureBytesServed=the string "many"/);
    assert.match(current.reasons, /does not record its request count/);
    // No corroboration arithmetic is attempted with an unusable operand.
    assert.doesNotMatch(current.reasons, /does not corroborate the reads/);
  } finally {
    root.cleanup();
  }
});

test('NC2: only the undecidable relationship is lost, the others still run', () => {
  const root = new TempRoot();
  try {
    // No validated-window count, so neither ledger relationship can be stated; every
    // other numeric assertion is still decided on its own evidence.
    const result = decide(root, { omit: ['testedWindows'] });
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.assertions[LEDGER], 'inconclusive', current.reasons);
    assert.match(current.reasons, /does not record its validated-window count/);
    assert.equal(current.assertions[TRANSPORT], 'inconclusive');
    assert.equal(current.assertions[WINDOW_BOUND], 'pass');
    assert.equal(current.assertions['values-match-independent-reference'], 'pass');
    assert.equal(current.assertions['validity-matches-reference-exactly'], 'pass');
    assert.equal(current.assertions['no-single-request-returns-whole-artifact'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('NC2: unaffected requirements stay decided while the numeric ones fail', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, {
      q2: { testedWindows: 0.5 },
      omitLedger: ['fixtureRequests'],
    });
    const requirements = result.decision?.['requirements'] as { id: string; verdict: string }[];
    assert.equal(requirements.find((entry) => entry.id === 'Q-ART-1')?.verdict, 'pass');
    assert.equal(requirements.find((entry) => entry.id === 'Q-DISPLAY-1')?.verdict, 'pass');
    assert.equal(requirements.find((entry) => entry.id === 'Q-PREP-1')?.verdict, 'pass');
    assert.equal(result.status, 1, result.stderr);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Bounded matrix over the three counters
// --------------------------------------------------------------------------

interface CounterCase {
  readonly label: string;
  /** The replacement report body for this case. */
  readonly q2: Rec;
  readonly omit?: readonly string[];
  readonly assertion: string;
  readonly expected: string;
  readonly reason: RegExp;
}

const COUNTER_MATRIX: readonly CounterCase[] = [
  // Valid whole values: the coherent control, unchanged per counter.
  { label: 'windows whole', q2: { testedWindows: 9 }, assertion: LEDGER, expected: 'pass', reason: /./ },
  {
    label: 'bytes whole',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'pass',
    reason: /./,
  },
  {
    label: 'requests whole',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'pass',
    reason: /./,
  },
  // Zero: a valid value that can also contradict another counter.
  {
    label: 'windows zero with activity',
    q2: { testedWindows: 0 },
    assertion: LEDGER,
    expected: 'fail',
    reason: /records 4194304 byte\(s\) although no window was validated/,
  },
  {
    label: 'bytes zero with validated windows',
    q2: { serverLedger: { fixtureBytesServed: 0, fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /validates 9 window\(s\) but its transport ledger records 0 byte\(s\)/,
  },
  {
    label: 'requests zero with validated windows',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 0 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /validates 9 window\(s\) but its transport ledger records 0 request\(s\)/,
  },
  // Fractions are not counts.
  {
    label: 'windows fractional',
    q2: { testedWindows: 0.5 },
    assertion: LEDGER,
    expected: 'fail',
    reason: /testedWindows=0\.5, which is not a whole non-negative validated-window count/,
  },
  {
    label: 'bytes fractional',
    q2: { serverLedger: { fixtureBytesServed: 0.5, fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureBytesServed=0\.5, which is not a whole non-negative byte count/,
  },
  {
    label: 'requests fractional',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 0.5 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureRequests=0\.5, which is not a whole non-negative request count/,
  },
  // Negative values are recorded impossibilities.
  {
    label: 'windows negative',
    q2: { testedWindows: -1 },
    assertion: TRANSPORT,
    expected: 'fail',
    reason: /records -1 validated window\(s\), which is not a possible count/,
  },
  {
    label: 'bytes negative',
    q2: { serverLedger: { fixtureBytesServed: -1, fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /records -1 byte\(s\) served, which is not a possible byte count/,
  },
  {
    label: 'requests negative',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: -2 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /records -2 request\(s\), which is not a possible request count/,
  },
  // Malformed types.
  {
    label: 'windows null',
    q2: { testedWindows: null },
    assertion: TRANSPORT,
    expected: 'fail',
    reason: /testedWindows=null, which is not a whole non-negative validated-window count/,
  },
  {
    label: 'bytes string',
    q2: { serverLedger: { fixtureBytesServed: '9', fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureBytesServed=the string "9"/,
  },
  {
    label: 'requests boolean',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: true } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureRequests=the boolean true/,
  },
  {
    label: 'requests list',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: [12] } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureRequests=a list/,
  },
  {
    label: 'requests object',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: { n: 12 } } },
    assertion: LEDGER,
    expected: 'fail',
    reason: /fixtureRequests=an object/,
  },
  // Absent values gap.
  {
    label: 'windows absent',
    q2: {},
    omit: ['testedWindows'],
    assertion: LEDGER,
    expected: 'inconclusive',
    reason: /does not record its validated-window count/,
  },
  {
    label: 'bytes absent',
    q2: { serverLedger: { fixtureRequests: 12 } },
    assertion: LEDGER,
    expected: 'inconclusive',
    reason: /does not record its byte count/,
  },
  {
    label: 'requests absent',
    q2: { serverLedger: { fixtureBytesServed: 4_194_304 } },
    assertion: LEDGER,
    expected: 'inconclusive',
    reason: /does not record its request count/,
  },
];

test('matrix: every counter value is classified on its own assertion', () => {
  for (const entry of COUNTER_MATRIX) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2: entry.q2, ...(entry.omit === undefined ? {} : { omit: entry.omit }) });
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(
        current.assertions[entry.assertion],
        entry.expected,
        `${entry.label}: ${current.reasons}`,
      );
      // A passing requirement legitimately carries no reasons; every other case must
      // name the counter and the rule it broke.
      if (entry.expected !== 'pass') assert.match(current.reasons, entry.reason, entry.label);
      if (entry.expected === 'fail') assert.equal(current.verdict, 'fail', entry.label);
      if (entry.expected === 'inconclusive') assert.notEqual(current.verdict, 'pass', entry.label);
      // The window-bound assertion is never implicated by a counter case.
      assert.equal(current.assertions[WINDOW_BOUND], 'pass', `${entry.label}: ${current.reasons}`);
    } finally {
      root.cleanup();
    }
  }
});

test('matrix: a zero validated-window count is judged by the ledger, not only by transport', () => {
  const cases: readonly (readonly [string, Rec, readonly string[]])[] = [
    ['positive bytes, request count absent', { testedWindows: 0, serverLedger: { fixtureBytesServed: 4096 } }, ['fixtureRequests']],
    ['positive requests, byte count absent', { testedWindows: 0, serverLedger: { fixtureRequests: 4 } }, ['fixtureBytesServed']],
    ['both positive', { testedWindows: 0, serverLedger: { fixtureBytesServed: 4096, fixtureRequests: 4 } }, []],
  ];
  for (const [label, q2, omitLedger] of cases) {
    const root = new TempRoot();
    try {
      const result = decide(root, { q2, omitLedger });
      const current = requirementState(result, 'Q-LOCAL-1');
      // The transport assertion reports the zero read; the ledger must independently
      // record the contradiction rather than being skipped.
      assert.equal(current.assertions[TRANSPORT], 'fail', `${label}: ${current.reasons}`);
      assert.equal(current.assertions[LEDGER], 'fail', `${label}: ${current.reasons}`);
      assert.match(current.reasons, /although no window was validated/, label);
    } finally {
      root.cleanup();
    }
  }
});
