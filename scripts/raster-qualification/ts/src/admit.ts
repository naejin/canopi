/**
 * Admitting one report as evidence.
 *
 * Admission answers three questions the requirement mappings must not answer for
 * themselves:
 *
 * 1. did the report's own run succeed, and are its declared preconditions met?
 * 2. does the identity it recorded match the route, environment, fixture and
 *    artifact the declaration says it should have used?
 * 3. does it carry enough provenance to be traceable at all?
 *
 * Everything is collected before anything is reduced. A missing field is a gap; a
 * field that disagrees with the declaration is a failure; and a failure survives
 * every gap that accompanies it.
 *
 * `sourceAdmitted` records whether the *source* may contribute evidence. It is
 * deliberately separate from the reduced verdict, because a requirement whose
 * admitted observation failed the requirement is a finding about the engine, while
 * a source that could not be admitted is a finding about the record. Collapsing
 * the two is how a measured violation gets filed as unusable evidence.
 */

import { describe, isNonEmptyString, isRecord, timestampSeconds } from './fields.js';
import type { FixtureManifest, PinDeclaration } from './declaration.js';
import type { AdmissionFacts, ReportShape } from './report.js';
import { Findings, type Verdict } from './verdict.js';

/** Identity fields a report must record to be traceable at all. */
export const REQUIRED_IDENTITY_FIELDS = ['id', 'experiment', 'command', 'environment'] as const;

/** Identity fields compared against the declaration. */
const COMPARED_IDENTITY_FIELDS: readonly [string, string][] = [
  ['routeId', 'route'],
  ['environment', 'environment'],
  ['host', 'host'],
  ['transport', 'transport'],
];

/** Fixture policies a report may declare. */
export const FIXTURE_POLICIES = ['measured', 'artifact-only'] as const;

export interface SourceExpectations {
  /** The report role this source is read for, e.g. `q2`. */
  readonly role: string;
  /** The experiment identifier this role's report must record. */
  readonly experiment: string;
  readonly routeId?: string;
  readonly environment?: string;
  readonly host?: string;
  readonly transport?: string;
  /** Declared for the role; its absence is reported rather than skipped. */
  readonly expectedArtifact?: { readonly name: string; readonly version: string };
  /**
   * Whether the declaration retains this engine rather than pinning it.
   *
   * The plan retains native GDAL for preparation, CRS and slope: the *name* must
   * still be the declared engine, while the version is whatever the run discovered.
   * "Unpinned" therefore means the version is not declared, not that any engine is
   * acceptable.
   */
  readonly unpinnedEngine?: boolean;
  /** Declared measured artifacts that must be covered by correspondence. */
  readonly requiredArtifacts?: readonly { readonly name: string; readonly version?: string }[];
  /** Whether the requirement this source feeds must be evidenced on a raster. */
  readonly requiresRasterFixture: boolean;
  /** Hosts a report may record in the selected profile. */
  readonly acceptedHosts?: readonly string[];
  readonly fixtureManifest?: FixtureManifest;
  readonly declaredPins?: PinDeclaration;
  /** Whether the declaration was usable; a gap here blocks coverage. */
  readonly fixtureManifestVerdict?: Verdict;
  readonly fixtureManifestProblems?: readonly string[];
  readonly pinVerdict?: Verdict;
  readonly pinProblems?: readonly string[];
  /** Unpinned artifact roles the plan explicitly allows. */
  readonly unpinnedRoles?: readonly string[];
  /** Evaluation time, supplied by the caller so tests are deterministic. */
  readonly now?: number;
}

export interface Admission {
  readonly label: string;
  readonly verdict: Verdict;
  /** Whether the source itself may contribute evidence. */
  readonly sourceAdmitted: boolean;
  readonly reasons: readonly string[];
  readonly identity: Record<string, unknown>;
  readonly sourceDigest?: string;
  readonly positiveFailures: readonly string[];
  readonly negativeControlFailures: readonly string[];
}

/**
 * Admit one report.
 *
 * `absent` and `corrupt` sources are reported with their own wording: a report the
 * caller never supplied is a gap, while a report that exists but cannot be read is
 * a failure and must not be described as missing.
 */
export function admitReport(
  shape: ReportShape | undefined,
  facts: AdmissionFacts | undefined,
  label: string,
  expectations: SourceExpectations,
  source: { readonly status: 'present' | 'absent' | 'corrupt'; readonly problem?: string; readonly digest?: string },
): Admission {
  if (shape === undefined || facts === undefined) {
    if (source.status === 'corrupt') {
      return {
        label,
        verdict: 'fail',
        sourceAdmitted: false,
        reasons: [source.problem ?? `${label} is unusable`],
        identity: {},
        ...(source.digest === undefined ? {} : { sourceDigest: source.digest }),
        positiveFailures: [],
        negativeControlFailures: [],
      };
    }
    return {
      label,
      verdict: 'inconclusive',
      sourceAdmitted: false,
      reasons: [source.problem ?? `${label} is missing`],
      identity: {},
      positiveFailures: [],
      negativeControlFailures: [],
    };
  }

  const findings = new Findings();
  const positives: string[] = [];
  const controls: string[] = [];

  // Malformed report structure is a failure of the record itself; a field the
  // producer did not write is a gap in the record.
  for (const problem of shape.problems) findings.fail(problem);
  for (const gap of shape.gaps) findings.gap(gap);

  // 1. The report's own verdict.
  if (!facts.resultDeclared) {
    findings.gap(`${label} declares no result, so it is not a qualification report`);
  } else if (facts.result === undefined) {
    // Present but unusable was already reported as a structural problem; keep the
    // finding so the reduction cannot mistake it for absence.
    findings.fail(`${label} declares an unusable result`);
  } else if (facts.result === 'fail') {
    findings.fail(
      facts.failures.length > 0
        ? `${label} reports result=fail with failures: ${facts.failures.slice(0, 5).join('; ')}`
        : `${label} reports result=fail`,
    );
  } else if (facts.result === 'inconclusive') {
    findings.gap(`${label} reports result=inconclusive`);
  } else if (facts.result !== 'pass') {
    findings.fail(`${label} declares an unusable result ${JSON.stringify(facts.result)}`);
  }

  // 2. Recorded failures, whose scope decides whether they are positive findings.
  const scopes = negativeControlScopes(shape.value);
  for (const failure of facts.failures) {
    if (scopes.some((scope) => failure.startsWith(scope))) controls.push(failure);
    else positives.push(failure);
  }
  if (positives.length > 0) {
    if (facts.result !== 'fail') {
      findings.fail(
        `${label} records failures while declaring result=${JSON.stringify(facts.result ?? null)}: ${positives.slice(0, 5).join('; ')}`,
      );
    }
  }

  // 3. Assertions the report marked failed, read independently of `result`.
  const failedAssertions: string[] = [];
  for (const [name, assertion] of facts.assertions) {
    if (assertion.ok === false) failedAssertions.push(name);
  }
  if (failedAssertions.length > 0) {
    findings.fail(
      `${label} records ${failedAssertions.length} failed assertion(s): ${failedAssertions.slice(0, 5).join('; ')}`,
    );
  }

  // 4. A `result` that contradicts the report's own assertions is corrupt.
  if (facts.result === 'pass' && failedAssertions.length > 0) {
    findings.fail(
      `${label} reports result=pass but ${failedAssertions.length} assertion(s) failed`,
    );
  }

  // 5. Preconditions the report names as gating its observations.
  for (const precondition of facts.preconditions) {
    if (precondition.met === false) {
      findings.fail(`${label} precondition not met: ${precondition.name}`);
    }
  }

  // 6. Provenance: identity, a usable recorded time, freshness, and the digest of
  //    the bytes actually read.
  const identity = facts.identity;
  if (identity === undefined) {
    findings.gap(
      `${label} carries no identity block, so its route, environment and fixture provenance cannot be verified`,
    );
  } else {
    for (const name of REQUIRED_IDENTITY_FIELDS) {
      if (!isNonEmptyString(identity[name])) {
        findings.gap(`${label} identity does not record ${name}`);
      }
    }
    const recordedAt = timestampSeconds(identity['recordedAt']);
    if (recordedAt === undefined) {
      findings.gap(`${label} identity does not record a usable recordedAt`);
    } else {
      const now = expectations.now ?? Date.now() / 1000;
      const ageDays = (now - recordedAt) / 86400;
      if (ageDays < 0) {
        findings.fail(`${label} recordedAt is in the future by ${(-ageDays).toFixed(2)} day(s)`);
      } else if (ageDays > SOURCE_AGE_LIMIT_DAYS) {
        findings.fail(
          `${label} source evidence is stale: recorded ${ageDays.toFixed(2)} day(s) ago, limit ${SOURCE_AGE_LIMIT_DAYS} day(s)`,
        );
      }
    }
    const claimed = identity['digest'];
    if (isNonEmptyString(claimed) && source.digest !== undefined && claimed !== source.digest) {
      findings.fail(
        `${label} digest conflict: the report claims ${claimed} but the bytes read hash to ${source.digest}`,
      );
    }
  }

  // 7. Identity must agree with the declaration. The role fixes the expectation, so
  //    a caller cannot withdraw a comparison by omitting it.
  if (identity !== undefined) {
    const recordedExperiment = identity['experiment'];
    if (isNonEmptyString(recordedExperiment) && recordedExperiment !== expectations.experiment) {
      findings.fail(
        `${label} identity names experiment ${JSON.stringify(recordedExperiment)} but ${JSON.stringify(expectations.experiment)} was expected`,
      );
    }
    for (const [key, label] of COMPARED_IDENTITY_FIELDS) {
      const declared = declaredComparison(expectations, key);
      if (declared === undefined) continue;
      const observed = identity[key];
      if (observed === undefined || observed === null) {
        findings.gap(
          `${label} does not record the ${label} it measured, so it cannot be matched to the declared ${label} (${JSON.stringify(declared)})`,
        );
      } else if (!isNonEmptyString(observed)) {
        findings.fail(`${label} records ${describe(observed)} as its ${label}, which is not text`);
      } else if (observed !== declared) {
        if (key === 'transport') {
          // A real but different capability is insufficient rather than invalid:
          // the observation is genuine, it is simply not the required route.
          findings.gap(
            `${label} measured transport ${JSON.stringify(observed)} but ${JSON.stringify(declared)} is required; the recorded capability is real but is not the required route`,
          );
        } else {
          findings.fail(
            `${label} ${label} conflict: expected ${JSON.stringify(declared)}, observed ${JSON.stringify(observed)}`,
          );
        }
      }
    }
    const artifact = identity['artifact'];
    if (expectations.expectedArtifact !== undefined) {
      if (!isRecord(artifact)) {
        findings.gap(
          `${label} does not record which artifact it exercised, so it cannot be matched to the declared artifact`,
        );
      } else {
        const keysToCompare = expectations.unpinnedEngine === true
          ? (['name'] as const)
          : (['name', 'version'] as const);
        for (const key of keysToCompare) {
          const declaredValue = expectations.expectedArtifact[key];
          const observedValue = artifact[key];
          if (observedValue === undefined || observedValue === null) {
            findings.gap(`${label} artifact does not record its ${key}`);
          } else if (observedValue !== declaredValue) {
            findings.fail(
              `${label} artifact ${key} conflict: expected ${JSON.stringify(declaredValue)}, observed ${JSON.stringify(observedValue)}`,
            );
          }
        }
        if (expectations.unpinnedEngine === true) {
          // The declared engine is retained with a discovered version; the version is
          // recorded for review rather than compared with a declared value.
          const version = artifact['version'];
          if (!isNonEmptyString(version)) {
            findings.gap(
              `${label} records no version for the retained engine ${JSON.stringify(expectations.expectedArtifact.name)}`,
            );
          }
        }
      }
    }
  }

  // 8. Fixture identity, policy and hash.
  applyFixtureChecks(shape, identity, label, expectations, findings);

  const summary = findings.summary();

  return {
    label,
    verdict: summary.verdict,
    sourceAdmitted: summary.verdict === 'pass',
    reasons: findings.reasons(),
    identity: identity ?? {},
    ...(source.digest === undefined ? {} : { sourceDigest: source.digest }),
    positiveFailures: positives,
    negativeControlFailures: controls,
  };
}

/** The plan's freshness limit for source evidence. */
export const SOURCE_AGE_LIMIT_DAYS = 7;

function declaredComparison(expectations: SourceExpectations, key: string): string | undefined {
  switch (key) {
    case 'routeId':
      return expectations.routeId;
    case 'environment':
      return expectations.environment;
    case 'host':
      return expectations.host;
    case 'transport':
      return expectations.transport;
    default:
      return undefined;
  }
}

/**
 * The prefixes a report declares as negative-control scope.
 *
 * A scope may only exempt a failure that is genuinely a control rejection. An
 * arbitrary report-chosen prefix would let any positive failure be relabelled out of
 * the way, so a scope must be an explicit, namespaced declaration rather than a bare
 * substring of the failure text.
 */
export const NEGATIVE_CONTROL_PREFIX = 'expected-rejection:';

function negativeControlScopes(value: Record<string, unknown>): string[] {
  const declared = value['negativeControlScopes'];
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (scope): scope is string =>
      isNonEmptyString(scope) && scope.endsWith(NEGATIVE_CONTROL_PREFIX),
  );
}

function applyFixtureChecks(
  shape: ReportShape,
  identity: Record<string, unknown> | undefined,
  label: string,
  expectations: SourceExpectations,
  findings: Findings,
): void {
  if (identity === undefined) {
    findings.gap(`${label} carries no identity block, so fixture coverage cannot be established`);
    return;
  }
  const policy = identity['fixturePolicy'];
  if (!isNonEmptyString(policy) || !(FIXTURE_POLICIES as readonly string[]).includes(policy)) {
    findings.gap(
      `${label} does not declare a fixture policy (one of ${FIXTURE_POLICIES.join(', ')})`,
    );
    return;
  }
  const fixturesValue = identity['fixtures'];
  const fixtures = Array.isArray(fixturesValue) ? fixturesValue : undefined;
  if (fixtures === undefined) {
    findings.gap(`${label} identity fixtures are not a list`);
    return;
  }
  if (expectations.requiresRasterFixture && policy !== 'measured') {
    findings.gap(
      `${label} declares fixturePolicy=${JSON.stringify(policy)} but this requirement must be evidenced by a measured raster fixture`,
    );
    return;
  }
  if (!expectations.requiresRasterFixture && policy === 'measured' && fixtures.length === 0) {
    findings.gap(`${label} declares fixturePolicy=measured but names no fixture`);
  }
  if (policy !== 'measured') return;

  const observed: { name: string; sha256: string }[] = [];
  const seen = new Set<string>();
  fixtures.forEach((entry, index) => {
    if (!isRecord(entry) || !isNonEmptyString(entry['name'])) {
      findings.gap(`${label} names a fixture without an identity at index ${index}`);
      return;
    }
    const name = entry['name'];
    const hash = entry['sha256'];
    if (!isNonEmptyString(hash)) {
      findings.gap(`${label} fixture ${JSON.stringify(name)} records no hash`);
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      findings.fail(`${label} fixture ${JSON.stringify(name)} records a malformed sha256`);
      return;
    }
    if (seen.has(name)) {
      findings.fail(`${label} records duplicate fixture identities: ${name}`);
      return;
    }
    seen.add(name);
    observed.push({ name, sha256: hash });
  });

  const tested = shape.value['fixturesTested'];
  if (tested === undefined || tested === null) {
    findings.gap(`${label} does not record how many fixtures it measured`);
  } else if (typeof tested !== 'number' || !Number.isInteger(tested) || tested < 0) {
    findings.fail(`${label} records fixturesTested=${describe(tested)}, not a count`);
  } else if (tested !== observed.length) {
    findings.fail(
      `${label} names ${observed.length} fixture(s) but records fixturesTested=${tested}`,
    );
  }

  if (fixtures.length === 0) {
    findings.gap(`${label} measures a raster but names no fixture identity`);
    return;
  }

  const manifest = expectations.fixtureManifest;
  if (expectations.fixtureManifestVerdict === 'fail') {
    for (const problem of expectations.fixtureManifestProblems ?? []) findings.fail(problem);
    return;
  }
  if (manifest === undefined || expectations.fixtureManifestVerdict !== 'pass') {
    // The declaration is incomplete, so coverage of the required set cannot be
    // established — but the fixtures it *does* declare remain usable expectations, and
    // an observed fixture that contradicts one is still a conflict. Returning here
    // would let a gap in the declaration hide a known disagreement.
    for (const problem of expectations.fixtureManifestProblems ?? []) findings.gap(problem);
    const partial = manifest?.declared ?? [];
    const partialByName = new Map(partial.map((m) => [m.name, m.sha256]));
    for (const fixture of observed) {
      const declaredHash = partialByName.get(fixture.name);
      if (declaredHash !== undefined && declaredHash !== fixture.sha256) {
        findings.fail(
          `${label} fixture ${JSON.stringify(fixture.name)} hash conflict: the declaration records ${declaredHash}, observed ${fixture.sha256}`,
        );
      }
    }
    return;
  }

  const required = manifest.requiredByRole.get(expectations.role) ??
    manifest.requiredByRole.get('*') ?? [];
  const declaredByName = new Map(manifest.declared.map((m) => [m.name, m.sha256]));
  const observedNames = new Set(observed.map((o) => o.name));

  const missing = required.filter((name) => !observedNames.has(name));
  if (missing.length > 0) {
    findings.gap(`${label} does not cover required fixture(s): ${missing.join(', ')}`);
  }
  for (const fixture of observed) {
    if (!declaredByName.has(fixture.name)) {
      findings.fail(
        `${label} measures undeclared fixture ${JSON.stringify(fixture.name)}, which is not in the declared fixture manifest`,
      );
      continue;
    }
    const declaredHash = declaredByName.get(fixture.name)!;
    if (declaredHash !== fixture.sha256) {
      findings.fail(
        `${label} fixture ${JSON.stringify(fixture.name)} hash conflict: expected ${declaredHash}, observed ${fixture.sha256}`,
      );
    }
  }
}
