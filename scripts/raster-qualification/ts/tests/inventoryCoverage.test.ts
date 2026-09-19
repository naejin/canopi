/**
 * S5 acceptance — inventory coverage, drift and entry-point parity.
 *
 * The check inventory is only trustworthy if it covers the contract completely and
 * nothing else decides verdicts beside it. These tests compare the declared inventory
 * with `requirements.json`, refuse a second verdict writer, and require the
 * programmatic entry point and the CLI to agree over the coherent corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PLAN } from './fixtures.js';
import { CHECK_INVENTORIES, MAPPINGS } from '../src/evidence/registry.js';
import { validateContract, validateFixtureManifest, validatePinDeclaration } from '../src/declaration.js';
import { runQualification, type QualificationRequest } from '../src/qualification.js';
import { DECLARATIONS } from '../src/declared/route.js';

type Rec = globalThis.Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_SOURCE = resolve(HERE, '../../src/evidence');

function contractRequirements(): readonly { id: string; required: boolean; assertions: readonly string[] }[] {
  const parsed = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;
  const validated = validateContract(parsed, 'contract');
  assert.equal(validated.verdict, 'pass');
  return validated.value!.requirements;
}

test('S5 coverage: every required obligation has one checked inventory', () => {
  const required = contractRequirements().filter((entry) => entry.required);
  assert.ok(required.length > 0);
  for (const spec of required) {
    const inventory = CHECK_INVENTORIES.get(spec.id);
    assert.ok(inventory !== undefined, `${spec.id} has no check inventory`);
    assert.ok(MAPPINGS.has(spec.id), `${spec.id} has no mapping`);
    assert.deepEqual(
      [...inventory.assertions].sort(),
      [...spec.assertions].sort(),
      `${spec.id} does not declare exactly the contract's assertions`,
    );
  }
  // No inventory claims an obligation the contract does not declare.
  for (const id of CHECK_INVENTORIES.keys()) {
    assert.ok(
      required.some((spec) => spec.id === id),
      `${id} has an inventory but is not a required obligation`,
    );
  }
});

test('S5 coverage: every assertion is decided or explicitly unsupported', () => {
  for (const [id, inventory] of CHECK_INVENTORIES) {
    const implemented = new Set(inventory.checks.map((check) => check.id));
    const required = new Set(inventory.required);
    const decidedBy = new Map<string, number>();
    for (const check of inventory.checks) {
      assert.ok(
        inventory.assertions.includes(check.assertion),
        `${id}: check ${check.id} names an assertion the requirement does not declare`,
      );
      decidedBy.set(check.assertion, (decidedBy.get(check.assertion) ?? 0) + 1);
    }
    for (const checkId of inventory.required) {
      assert.ok(implemented.has(checkId), `${id}: required check ${checkId} is not implemented`);
    }
    for (const check of inventory.checks) {
      assert.ok(required.has(check.id), `${id}: check ${check.id} is not in the declared inventory`);
    }
    const ids = inventory.checks.map((check) => check.id);
    assert.equal(new Set(ids).size, ids.length, `${id}: duplicate check id`);
    for (const assertion of inventory.assertions) {
      const covered = (decidedBy.get(assertion) ?? 0) > 0;
      const unsupported = inventory.unsupported.has(assertion);
      assert.ok(
        covered || unsupported,
        `${id}: assertion ${assertion} has no check and no unsupported reason`,
      );
      assert.ok(
        !(covered && unsupported),
        `${id}: assertion ${assertion} is both checked and declared unsupported`,
      );
      if (unsupported) {
        const reason = inventory.unsupported.get(assertion)!;
        assert.ok(reason.length > 0, `${id}: ${assertion} has an empty unsupported reason`);
      }
    }
  }
});

test('S5 drift: no evidence module writes an assertion verdict directly', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(EVIDENCE_SOURCE)) {
    if (!file.endsWith('.ts')) continue;
    if (file === 'checks.ts') continue;
    const text = readFileSync(join(EVIDENCE_SOURCE, file), 'utf8');
    for (const pattern of ['assertions.set(', 'unresolved(', "verdicts.set("]) {
      if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `a module still decides verdicts itself: ${offenders.join(', ')}`);
});

test('S5 drift: the decision reports a receipt for every executed check', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: root.write(`reports/${role}.json`, reports[role]!),
    }));
    const request = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const out = join(root.path, 'decision.json');
    const result = runCli(request, out);
    assert.equal(result.status, 1, result.stderr);
    const requirements = result.decision?.['requirements'] as
      | { id: string; assertions: Rec; checks: Rec[]; reasons: string[] }[]
      | undefined;
    assert.ok(requirements !== undefined);
    for (const entry of requirements) {
      const inventory = CHECK_INVENTORIES.get(entry.id);
      if (inventory === undefined) continue;
      const receipts = entry.checks.map((receipt) => receipt['check']);
      assert.deepEqual(
        [...receipts].sort(),
        inventory.checks.map((check) => check.id).sort(),
        `${entry.id}: the decision does not receipt exactly the declared checks`,
      );
      for (const receipt of entry.checks) {
        assert.equal(typeof receipt['assertion'], 'string', `${entry.id}: receipt without an assertion`);
        assert.equal(receipt['defect'], undefined, `${entry.id}: unexpected check defect`);
        assert.ok(
          ['pass', 'fail', 'inconclusive'].includes(String(receipt['verdict'])),
          `${entry.id}: receipt without a verdict`,
        );
      }
      // An assertion that could not pass states why, so no gap is silent.
      for (const [assertion, verdict] of Object.entries(entry.assertions)) {
        if (verdict === 'pass') continue;
        assert.ok(
          entry.reasons.some((reason) => reason.includes(assertion)) ||
            entry.reasons.length > 0,
          `${entry.id}: ${assertion} is ${String(verdict)} with no reason at all`,
        );
      }
    }
  } finally {
    root.cleanup();
  }
});

test('S5 parity: the programmatic entry point and the CLI agree requirement for requirement', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const sources = SOURCE_ROLES.map((role) => {
      const path = root.write(`reports/${role}.json`, reports[role]!);
      return { role, path };
    });
    const contract = validateContract(
      JSON.parse(readFileSync(realContractPath(), 'utf8')),
      'contract',
    );
    assert.equal(contract.verdict, 'pass');
    // The same declarations the CLI request carries, so the comparison isolates the
    // entry point rather than the declarations.
    const manifest = validateFixtureManifest(fixtureManifest(), 'fixture manifest');
    const pins = validatePinDeclaration(candidatePins(), 'candidate pins');
    const request: QualificationRequest = {
      contract: contract.value!,
      sources,
      now: NOW,
      fixtureManifest: manifest,
      pins,
    };
    const outcome = runQualification(request);
    assert.equal(outcome.ok, true);
    const cli = runCli(root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: sources.map(({ role, path }) => ({ role, path })),
    }), join(root.path, 'decision.json'));
    if (!outcome.ok) throw new Error('unreachable');
    const cliRequirements = cli.decision?.['requirements'] as { id: string; verdict: string }[];
    for (const requirement of outcome.decision.requirements) {
      const mirrored = cliRequirements.find((entry) => entry.id === requirement.id);
      assert.equal(mirrored?.verdict, requirement.verdict, `${requirement.id} differs between entry points`);
    }
  } finally {
    root.cleanup();
  }
});

test('S5 plan bounds: the declarations the checks enforce match the plan', () => {
  // The plan states >=100 tile requests in each cold/warm run and >=100 individual
  // latencies per run; the coherent fixture is built from the same numbers.
  assert.equal(DECLARATIONS.minTileRequestsPerRun, 100);
  assert.equal(DECLARATIONS.minLatenciesPerRun, 100);
  assert.equal(DECLARATIONS.minTileRequestsPerRun, PLAN.minTileRequestsPerRun);
  assert.equal(DECLARATIONS.minLatenciesPerRun, PLAN.minLatenciesPerRun);
});
