/**
 * Q-ART-1 - candidate artifact correspondence, as explicit checks.
 *
 * The obligations are separate and each is decided on its own operands:
 *
 * - every required artifact needs its own version, integrity and license record;
 * - every bench-verified version that *is* recorded is compared against the
 *   declaration, even when another required artifact has no record at all;
 * - the pin a correspondence record claims is compared against the independent
 *   declaration whenever the claim is present, even when the built revision is not;
 * - the built revision must equal the declared pin, or be replaced by a fully
 *   evidenced build from that pin whose digest chain reaches every consuming source.
 *
 * A boolean, a prose note or a self-consistent pair of report-owned strings cannot
 * establish correspondence.
 */

import { asArray, describe, isNonEmptyString, isRecord } from '../fields.js';
import { isSha256 } from '../declaration.js';
import { ARTIFACT_BY_ROLE, ROUTE_ARTIFACTS, UNPINNED_ROLES } from '../declared/route.js';
import {
  contradicted,
  satisfied,
  sourceEvidence,
  unsatisfied,
  violated,
  type Check,
  type CheckContext,
  type EvidenceRef,
  type RequirementChecks,
} from './checks.js';

const ASSERTIONS = [
  'artifacts-present-at-declared-version',
  'artifacts-match-integrity-digest',
  'artifacts-record-license',
  'qualified-roles-name-artifact-version',
  'non-corresponding-artifacts-recorded',
  'apis-called-and-worker-target-recorded',
];

/** Artifact names the plan leaves unpinned, which have no integrity record. */
const UNPINNED_NAMES = new Set(UNPINNED_ROLES.map((entry) => entry.name));

/** The declared pulled artifacts, which are the ones correspondence covers. */
const REQUIRED_ARTIFACTS = ROUTE_ARTIFACTS.filter((artifact) => !UNPINNED_NAMES.has(artifact.name));

/** Roles that declare they exercised a given artifact. */
function consumingRoles(artifact: string): string[] {
  return Array.from(ARTIFACT_BY_ROLE)
    .filter(([, declared]) => declared.name === artifact)
    .map(([role]) => role);
}

interface ArtifactRead {
  readonly assertions: ReadonlyMap<string, { ok?: boolean }>;
  readonly verified: readonly unknown[];
  readonly correspondence: readonly unknown[];
  readonly notes: readonly unknown[];
}

function readArtifacts(context: CheckContext): { readonly read?: ArtifactRead; readonly reference?: EvidenceRef } {
  const view = context.byRole.get('q1');
  const reference = sourceEvidence(view, 'verifiedArtifacts');
  if (view === undefined || view.facts === undefined || view.shape === undefined || reference === undefined) {
    return {};
  }
  const value = view.shape.value;
  return {
    reference,
    read: {
      assertions: view.facts.assertions,
      verified: asArray(value['verifiedArtifacts']) ?? [],
      correspondence: asArray(value['sourceCorrespondence']) ?? [],
      notes: asArray(value['notes']) ?? [],
    },
  };
}

/** A check over one producer assertion record per required artifact. */
function recordCheck(
  id: string,
  assertion: string,
  key: (name: string) => string,
  label: string,
): Check {
  return {
    id,
    assertion,
    run: (context) => {
      const read = readArtifacts(context);
      if (read.read === undefined || read.reference === undefined) {
        return unsatisfied(['no artifact report was available']);
      }
      const failures: string[] = [];
      const gaps: string[] = [];
      const evidence: EvidenceRef[] = [read.reference];
      for (const artifact of REQUIRED_ARTIFACTS) {
        const name = key(artifact.name);
        const record = read.read.assertions.get(name);
        if (record === undefined) {
          gaps.push(`no ${label} record is recorded for ${artifact.name}`);
          continue;
        }
        if (record.ok === false) {
          failures.push(`${artifact.name} records a failed ${label} check (${name})`);
          continue;
        }
        if (record.ok === undefined) {
          gaps.push(`${artifact.name} records no outcome for its ${label} check (${name})`);
          continue;
        }
        const ref = sourceEvidence(context.byRole.get('q1'), `assertions[${name}]`, artifact.name);
        if (ref !== undefined) evidence.push(ref);
      }
      if (failures.length > 0) return violated(failures, evidence);
      if (gaps.length > 0) return unsatisfied(gaps, evidence);
      return satisfied(evidence);
    },
  };
}

/** The declared source pin for an artifact, when the declaration records one. */
function declaredPin(context: CheckContext, artifact: string): string | undefined {
  return context.byRole.get('q1')?.expectations.declaredPins?.contracts.get(artifact);
}

interface CorrespondenceRecord {
  readonly index: number;
  readonly key: string;
  readonly artifact: string;
  readonly version: string;
  readonly pinnedRevision: string | undefined;
  readonly revisionProblem?: string;
  readonly artifactRevision: string | undefined;
  readonly observedProblem?: string;
  readonly matches: unknown;
  readonly raw: Record<string, unknown>;
}

/**
 * Pair correspondence records with the required artifacts they claim.
 *
 * A record naming an artifact or version the route does not require is a failure,
 * because it makes the inventory unreliable; a duplicate key is ambiguous for the
 * same reason.
 */
function readCorrespondence(
  context: CheckContext,
  records: readonly unknown[],
): { readonly matched: readonly CorrespondenceRecord[]; readonly failures: string[]; readonly gaps: string[] } {
  const failures: string[] = [];
  const gaps: string[] = [];
  const matched: CorrespondenceRecord[] = [];
  const seen = new Set<string>();
  records.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push(`correspondence record ${index} is ${describe(entry)}, not an object`);
      return;
    }
    const artifact = entry['artifact'];
    const version = entry['version'];
    if (!isNonEmptyString(artifact)) {
      gaps.push(`correspondence record ${index} names no artifact`);
      return;
    }
    const key = `${artifact}@${String(version)}`;
    if (seen.has(key)) {
      failures.push(`duplicate artifact/source correspondence records: ${key}`);
      return;
    }
    seen.add(key);
    const required = REQUIRED_ARTIFACTS.find((candidate) => candidate.name === artifact);
    if (required === undefined) {
      failures.push(
        `${key}: the correspondence record names artifact ${JSON.stringify(artifact)}, which is not a required measured artifact`,
      );
      return;
    }
    if (version !== required.version) {
      failures.push(
        `${artifact} correspondence records version ${JSON.stringify(version)} but the route requires ${JSON.stringify(required.version)}`,
      );
      return;
    }
    const pinned = entry['pinnedRevision'];
    const built = entry['artifactRevision'];
    matched.push({
      index,
      key,
      artifact,
      version: required.version,
      pinnedRevision: isNonEmptyString(pinned) ? pinned : undefined,
      ...(pinned === undefined || pinned === null
        ? {}
        : isNonEmptyString(pinned)
          ? {}
          : { revisionProblem: `records pinnedRevision=${describe(pinned)}, which is not a revision` }),
      artifactRevision: isNonEmptyString(built) ? built : undefined,
      ...(built === undefined || built === null
        ? {}
        : isNonEmptyString(built)
          ? {}
          : { observedProblem: `records artifactRevision=${describe(built)}, which is not a revision` }),
      matches: entry['matches'],
      raw: entry,
    });
    void context;
  });
  return { matched, failures, gaps };
}

const verifiedVersions: Check = {
  id: 'artifacts.verified-versions',
  assertion: 'qualified-roles-name-artifact-version',
  run: (context) => {
    const read = readArtifacts(context);
    if (read.read === undefined || read.reference === undefined) {
      return unsatisfied(['no artifact report was available']);
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const byName = new Map<string, string>();
    read.read.verified.forEach((entry, index) => {
      if (!isRecord(entry)) {
        failures.push(`verified artifact ${index} is ${describe(entry)}, not an object`);
        return;
      }
      const name = entry['name'];
      const version = entry['version'];
      if (!isNonEmptyString(name) || !isNonEmptyString(version)) {
        gaps.push(`verified artifact ${index} does not record both a name and a version`);
        return;
      }
      if (byName.has(name)) {
        failures.push(
          `the artifact report records ${JSON.stringify(name)} more than once, so which version was verified is ambiguous`,
        );
        return;
      }
      byName.set(name, version);
    });
    // Every present record is compared; a missing record for one artifact never
    // suppresses the comparison for another.
    for (const artifact of REQUIRED_ARTIFACTS) {
      const recorded = byName.get(artifact.name);
      if (recorded === undefined) {
        gaps.push(`no bench-verified version is recorded for ${artifact.name}`);
        continue;
      }
      if (recorded !== artifact.version) {
        failures.push(
          `${artifact.name} was verified at version ${JSON.stringify(recorded)} but the route declares ${JSON.stringify(artifact.version)}`,
        );
      }
    }
    if (failures.length > 0) return contradicted(failures, gaps, [read.reference]);
    if (gaps.length > 0) return unsatisfied(gaps, [read.reference]);
    return satisfied([read.reference]);
  },
};

const correspondenceInventory: Check = {
  id: 'artifacts.correspondence-inventory',
  assertion: 'qualified-roles-name-artifact-version',
  run: (context) => {
    const read = readArtifacts(context);
    if (read.read === undefined || read.reference === undefined) {
      return unsatisfied(['no artifact report was available']);
    }
    if (read.read.correspondence.length === 0) {
      return unsatisfied(['no artifact/source correspondence was recorded'], [read.reference]);
    }
    const parsed = readCorrespondence(context, read.read.correspondence);
    if (parsed.failures.length > 0) return contradicted(parsed.failures, parsed.gaps, [read.reference]);
    if (parsed.gaps.length > 0) return unsatisfied(parsed.gaps, [read.reference]);
    return satisfied([read.reference]);
  },
};

const claimedPin: Check = {
  id: 'artifacts.claimed-pin',
  assertion: 'qualified-roles-name-artifact-version',
  run: (context) => {
    const read = readArtifacts(context);
    if (read.read === undefined || read.reference === undefined) {
      return unsatisfied(['no artifact report was available']);
    }
    if (read.read.correspondence.length === 0) {
      return unsatisfied(['no artifact/source correspondence was recorded'], [read.reference]);
    }
    const parsed = readCorrespondence(context, read.read.correspondence);
    const failures: string[] = [...parsed.failures];
    const gaps: string[] = [...parsed.gaps];
    const evidence: EvidenceRef[] = [read.reference];
    for (const record of parsed.matched) {
      const pin = declaredPin(context, record.artifact);
      if (pin === undefined) {
        gaps.push(`${record.artifact}: the declaration records no source pin for this artifact`);
        continue;
      }
      if (record.revisionProblem !== undefined) {
        failures.push(`${record.key}: ${record.revisionProblem}`);
        continue;
      }
      if (record.pinnedRevision === undefined) {
        gaps.push(`${record.key}: correspondence does not record the pin it was checked against`);
        continue;
      }
      if (record.pinnedRevision !== pin) {
        failures.push(
          `${record.key}: correspondence was recorded against pin ${record.pinnedRevision}, but the declaration pins ${pin}`,
        );
        continue;
      }
      const ref = sourceEvidence(
        context.byRole.get('q1'),
        `sourceCorrespondence[${record.index}].pinnedRevision`,
        record.artifact,
        pin,
      );
      if (ref !== undefined) evidence.push(ref);
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

/** Reasons the recorded replacement build does not establish the declared pin. */
function replacementProblems(
  context: CheckContext,
  record: CorrespondenceRecord,
  pin: string,
): { readonly failures: readonly string[]; readonly gaps: readonly string[]; readonly evidence: readonly EvidenceRef[] } {
  const failures: string[] = [];
  const gaps: string[] = [];
  const evidence: EvidenceRef[] = [];
  const primary = sourceEvidence(
    context.byRole.get('q1'),
    `sourceCorrespondence[${record.index}].artifactRevision`,
    record.artifact,
  );
  const fallback = sourceEvidence(context.byRole.get('q1'), 'sourceCorrespondence');
  if (primary !== undefined) evidence.push(primary);
  else if (fallback !== undefined) evidence.push(fallback);
  const built = record.raw['builtArtifact'];
  if (!isRecord(built)) {
    failures.push(
      `${record.key}: revision mismatch (declared pin ${pin}, artifact built from ${String(record.artifactRevision)}) with no built-artifact identity`,
    );
  } else {
    if (built['name'] !== record.artifact) {
      failures.push(`${record.key}: build evidence names artifact ${describe(built['name'])}`);
    }
    if (built['version'] !== record.version) {
      failures.push(`${record.key}: build evidence names version ${describe(built['version'])}`);
    }
    if (!isSha256(built['sha256'])) {
      failures.push(`${record.key}: build evidence records no usable artifact digest`);
    }
  }
  if (record.raw['sourceRevision'] !== pin) {
    failures.push(
      `${record.key}: build evidence records source revision ${describe(record.raw['sourceRevision'])}, not the declared pin ${pin}`,
    );
  }
  const buildEvidence = record.raw['buildEvidence'];
  if (!isRecord(buildEvidence) || Object.keys(buildEvidence).length === 0) {
    failures.push(
      `${record.key}: revision mismatch with only a build-evidence flag and no recorded build evidence`,
    );
  } else {
    if (!isNonEmptyString(buildEvidence['command'])) {
      failures.push(`${record.key}: build evidence records no command`);
    }
    if (!isSha256(buildEvidence['sha256'])) {
      failures.push(`${record.key}: build evidence records no usable digest`);
    }
    if (buildEvidence['log'] !== undefined && !isNonEmptyString(buildEvidence['log'])) {
      failures.push(`${record.key}: build evidence records a log reference that is not text`);
    }
  }
  if (record.raw['buildReproduced'] !== true) {
    failures.push(`${record.key}: build was not reported as reproduced`);
  }

  // The digest chain must reach the artifacts the run actually measured.
  const builtDigest = isRecord(built) && isSha256(built['sha256']) ? built['sha256'] : undefined;
  if (builtDigest !== undefined) {
    const verifiedEntry = readArtifacts(context).read?.verified.find(
      (entry) => isRecord(entry) && entry['name'] === record.artifact,
    );
    const verifiedDigest = isRecord(verifiedEntry) ? verifiedEntry['sha256'] : undefined;
    if (!isSha256(verifiedDigest)) {
      gaps.push(
        `${record.key}: the bench-verified record for ${record.artifact} does not record the built artifact's digest`,
      );
    } else if (verifiedDigest !== builtDigest) {
      failures.push(
        `${record.key}: the bench-verified digest ${verifiedDigest} does not match the built artifact digest ${builtDigest}`,
      );
    }
    for (const role of consumingRoles(record.artifact)) {
      const view = context.byRole.get(role);
      const identity = view?.facts?.identity;
      const artifact = isRecord(identity?.['artifact']) ? identity['artifact'] : undefined;
      const digest = artifact?.['sha256'];
      const label = `${role} identity.artifact.sha256`;
      if (view === undefined || view.status !== 'present' || identity === undefined) {
        gaps.push(`${record.key}: ${role} was not available to corroborate the built artifact digest`);
        continue;
      }
      if (digest === undefined || digest === null) {
        gaps.push(`${record.key}: ${label} is not recorded, so the digest chain is incomplete`);
        continue;
      }
      if (!isSha256(digest)) {
        failures.push(`${record.key}: ${label} is ${describe(digest)}, which is not a SHA-256 digest`);
        continue;
      }
      if (digest !== builtDigest) {
        failures.push(
          `${record.key}: ${label} records ${digest}, which does not match the built artifact digest ${builtDigest}`,
        );
        continue;
      }
      const ref = sourceEvidence(view, 'identity.artifact.sha256', role, builtDigest);
      if (ref !== undefined) evidence.push(ref);
    }
  }
  return { failures, gaps, evidence };
}

const observedRevision: Check = {
  id: 'artifacts.observed-revision',
  assertion: 'qualified-roles-name-artifact-version',
  run: (context) => {
    const read = readArtifacts(context);
    if (read.read === undefined || read.reference === undefined) {
      return unsatisfied(['no artifact report was available']);
    }
    if (read.read.correspondence.length === 0) {
      return unsatisfied(['no artifact/source correspondence was recorded'], [read.reference]);
    }
    const parsed = readCorrespondence(context, read.read.correspondence);
    const failures: string[] = [...parsed.failures];
    const gaps: string[] = [...parsed.gaps];
    const evidence: EvidenceRef[] = [read.reference];
    for (const record of parsed.matched) {
      const pin = declaredPin(context, record.artifact);
      if (pin === undefined) {
        gaps.push(`${record.artifact}: the declaration records no source pin for this artifact`);
        continue;
      }
      if (record.observedProblem !== undefined) {
        failures.push(`${record.key}: ${record.observedProblem}`);
        continue;
      }
      if (typeof record.matches === 'boolean' && record.matches === false && record.artifactRevision === pin) {
        failures.push(
          `${record.key}: the record says the artifact does not match the pin while recording the pinned revision`,
        );
      }
      if (record.matches !== undefined && record.matches !== null && typeof record.matches !== 'boolean') {
        failures.push(`${record.key}: records matches=${describe(record.matches)}, which is not a boolean`);
      }
      if (record.artifactRevision === undefined) {
        gaps.push(`${record.key}: correspondence does not record the revision the artifact was built from`);
        continue;
      }
      if (record.artifactRevision === pin) {
        const ref = sourceEvidence(
          context.byRole.get('q1'),
          `sourceCorrespondence[${record.index}].artifactRevision`,
          record.artifact,
          pin,
        );
        if (ref !== undefined) evidence.push(ref);
        continue;
      }
      const replacement = replacementProblems(context, record, pin);
      failures.push(...replacement.failures);
      gaps.push(...replacement.gaps);
      evidence.push(...replacement.evidence);
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const correspondenceCoverage: Check = {
  id: 'artifacts.correspondence-coverage',
  assertion: 'non-corresponding-artifacts-recorded',
  run: (context) => {
    const read = readArtifacts(context);
    if (read.read === undefined || read.reference === undefined) {
      return unsatisfied(['no artifact report was available']);
    }
    if (read.read.correspondence.length === 0) {
      return unsatisfied(['no artifact/source correspondence was recorded'], [read.reference]);
    }
    const parsed = readCorrespondence(context, read.read.correspondence);
    const covered = new Set(parsed.matched.map((record) => record.artifact));
    const missing = REQUIRED_ARTIFACTS.filter((artifact) => !covered.has(artifact.name)).map(
      (artifact) => artifact.name,
    );
    const gaps = [...parsed.gaps];
    if (missing.length > 0) {
      gaps.push(`no correspondence record covers required artifact(s): ${missing.join(', ')}`);
    }
    if (parsed.failures.length > 0) return contradicted(parsed.failures, gaps, [read.reference]);
    if (gaps.length > 0) return unsatisfied(gaps, [read.reference]);
    return satisfied([read.reference]);
  },
};

export const ARTIFACT_CHECKS: RequirementChecks = {
  requirementId: 'Q-ART-1',
  assertions: ASSERTIONS,
  required: [
    'artifacts.version-records',
    'artifacts.integrity-records',
    'artifacts.license-records',
    'artifacts.verified-versions',
    'artifacts.correspondence-inventory',
    'artifacts.claimed-pin',
    'artifacts.observed-revision',
    'artifacts.correspondence-coverage',
    'artifacts.api-and-worker-target',
  ],
  unsupported: new Map<string, string>(),
  checks: [
    recordCheck(
      'artifacts.version-records',
      'artifacts-present-at-declared-version',
      (name) => `version:${name}`,
      'declared-version',
    ),
    recordCheck(
      'artifacts.integrity-records',
      'artifacts-match-integrity-digest',
      (name) => `integrity:${name}`,
      'integrity',
    ),
    recordCheck(
      'artifacts.license-records',
      'artifacts-record-license',
      (name) => `license-recorded:${name}`,
      'license',
    ),
    verifiedVersions,
    correspondenceInventory,
    claimedPin,
    observedRevision,
    correspondenceCoverage,
    {
      id: 'artifacts.api-and-worker-target',
      assertion: 'apis-called-and-worker-target-recorded',
      run: (context) => {
        const view = context.byRole.get('q1');
        const reference = sourceEvidence(view, 'assertions[apis-and-worker-target-recorded]');
        if (view === undefined || view.facts === undefined || reference === undefined) {
          return unsatisfied(['no artifact report was available']);
        }
        const record = view.facts.assertions.get('apis-and-worker-target-recorded');
        if (record === undefined) {
          return unsatisfied(['the artifact report records no api/worker-target assertion']);
        }
        if (record.ok === false) {
          return violated(['the artifact report failed its api/worker-target assertion'], [reference]);
        }
        if (record.ok === undefined) {
          return unsatisfied(['the artifact report records no outcome for its api/worker-target assertion'], [reference]);
        }
        return satisfied([reference]);
      },
    },
  ],
};

export const ARTIFACT_PROVENANCE = {
  sourceRoles: ['q1'] as const,
  source: 'reports/q1-artifacts.json',
  legacyProducerCommand: 'measure.py q1-artifacts --bench <bench> --out reports/q1-artifacts.json',
  route: 'candidate artifact resolution',
  artifact: { name: 'multiple' },
  fixtures: [] as { name: string; sha256?: string }[],
};
