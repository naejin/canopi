/**
 * Q-ART-1 - candidate artifact correspondence.
 *
 * The artifact report covers every pinned candidate artifact the route uses. Two
 * obligations are separate and both are required: each exercised role must name a
 * bench-verified version, and each required artifact must correspond to the pinned
 * source revision.
 *
 * The assertion about non-correspondence is decided from the correspondence
 * inventory, not from a prose note: a complete inventory needs no note, and a note
 * cannot stand in for a missing record.
 */

import { asArray, describe, isNonEmptyString, isRecord } from '../fields.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { allNamed, named } from './numericTransport.js';
import { worse, type Verdict } from '../verdict.js';
import { ROUTE_ARTIFACTS, UNPINNED_ROLES } from '../declared/route.js';

/** Artifact names the plan leaves unpinned, which have no integrity record. */
const UNPINNED_NAMES = new Set(UNPINNED_ROLES.map((entry) => entry.name));

export function mapArtifactCorrespondence(source: SourceView | undefined): MappingResult {
  const assertions = unresolved([
    'artifacts-present-at-declared-version',
    'artifacts-match-integrity-digest',
    'artifacts-record-license',
    'qualified-roles-name-artifact-version',
    'non-corresponding-artifacts-recorded',
    'apis-called-and-worker-target-recorded',
  ]);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    source: 'reports/q1-artifacts.json',
    legacyProducerCommand: 'measure.py q1-artifacts --bench <bench> --out reports/q1-artifacts.json',
    route: 'candidate artifact resolution',
    artifact: { name: 'multiple' },
    fixtures: [],
  };

  if (source === undefined || source.facts === undefined || source.shape === undefined) {
    return {
      assertions,
      observations,
      failures,
      gaps: ['no artifact report was available'],
      ...base,
      sourceRoles: ['q1'],
    };
  }

  const value = source.shape.value;
  const named_ = source.facts.assertions;

  // Required sets come from the declaration, not from whichever names the report
  // supplied. A prefix match over the supplied list proves only that some record
  // exists under some name; it says nothing about whether the artifacts the route
  // needs were covered, and an unrelated name would satisfy it.
  const requiredArtifacts = ROUTE_ARTIFACTS.filter(
    (artifact) => !UNPINNED_NAMES.has(artifact.name),
  );
  assertions.set(
    'artifacts-present-at-declared-version',
    perArtifact(requiredArtifacts, named_, (name) => `version:${name}`, 'version'),
  );
  assertions.set(
    'artifacts-match-integrity-digest',
    perArtifact(requiredArtifacts, named_, (name) => `integrity:${name}`, 'integrity digest'),
  );
  assertions.set(
    'artifacts-record-license',
    perArtifact(requiredArtifacts, named_, (name) => `license-recorded:${name}`, 'license'),
  );
  assertions.set(
    'apis-called-and-worker-target-recorded',
    named(named_, 'apis-and-worker-target-recorded'),
  );

  observations['requiredArtifacts'] = requiredArtifacts.map((artifact) => artifact.name);

  const verified = asArray(value['verifiedArtifacts']) ?? [];
  const correspondence = asArray(value['sourceCorrespondence']) ?? [];
  observations['verifiedArtifacts'] = verified.length;
  observations['sourceCorrespondence'] = correspondence.length;

  assertions.set(
    'qualified-roles-name-artifact-version',
    worse(
      verifiedVersions(verified, failures, gaps, observations),
      pinnedCorrespondence(correspondence, failures, gaps, observations),
    ),
  );

  // Non-correspondence is recorded when the inventory covers every required
  // artifact, or when the report states it explicitly. A complete inventory has
  // nothing left unmatched to comment on.
  const requiredNames = new Set(ROUTE_ARTIFACTS.map((artifact) => artifact.name));
  const recordedNames = new Set(
    correspondence
      .filter(isRecord)
      .map((entry) => entry['artifact'])
      .filter(isNonEmptyString),
  );
  const notes = asArray(value['notes']) ?? [];
  const statesNonCorrespondence = notes.some(
    (note) => isNonEmptyString(note) && note.includes('no published artifact matches'),
  );
  const covered = Array.from(requiredNames).every((name) => recordedNames.has(name));
  observations['requiredArtifactNames'] = Array.from(requiredNames).sort();
  assertions.set(
    'non-corresponding-artifacts-recorded',
    statesNonCorrespondence || covered ? 'pass' : 'fail',
  );

  return {
    assertions,
    observations,
    failures,
    gaps,
    sourceRoles: ['q1'],
    ...base,
  };
}

/**
 * Whether every required artifact carries its own named record.
 *
 * A failure in any artifact's record fails the assertion; a missing record is a gap,
 * so an absent report is distinguishable from a report that contradicts itself.
 */
function perArtifact(
  required: readonly { name: string; version: string }[],
  named: ReadonlyMap<string, { ok?: boolean }>,
  key: (name: string) => string,
  label: string,
): Verdict {
  if (required.length === 0) return 'inconclusive';
  let verdict: Verdict = 'pass';
  for (const artifact of required) {
    const found = named.get(key(artifact.name));
    if (found === undefined) {
      verdict = worse(verdict, 'inconclusive');
      continue;
    }
    if (found.ok === false) {
      // A required artifact whose record failed cannot be carried by another
      // artifact's passing record.
      return 'fail';
    }
    if (found.ok === undefined) verdict = worse(verdict, 'inconclusive');
  }
  return verdict;
}

/** Each exercised role must name a version the bench verified. */
function verifiedVersions(
  verified: readonly unknown[],
  failures: string[],
  gaps: string[],
  observations: Record<string, unknown>,
): Verdict {
  if (verified.length === 0) {
    gaps.push('the artifact report records no bench-verified artifact versions');
    return 'inconclusive';
  }
  const unpinned = new Set(UNPINNED_ROLES.map((entry) => entry.name));
  const verifiedNames = new Set<string>();
  const verifiedVersionsByName = new Map<string, string>();
  verified.forEach((entry, index) => {
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
    verifiedNames.add(name);
    verifiedVersionsByName.set(name, version);
  });
  observations['verifiedArtifactNames'] = Array.from(verifiedNames).sort();
  const expected = ROUTE_ARTIFACTS.filter((artifact) => !unpinned.has(artifact.name));
  const missing = expected.filter((artifact) => !verifiedNames.has(artifact.name));
  if (missing.length > 0) {
    gaps.push(
      `no bench-verified version is recorded for ${missing.map((a) => a.name).join(', ')}`,
    );
    return 'inconclusive';
  }
  for (const artifact of expected) {
    const recorded = verifiedVersionsByName.get(artifact.name);
    if (recorded !== artifact.version) {
      failures.push(
        `${artifact.name} was verified at version ${JSON.stringify(recorded)} but the route declares ${JSON.stringify(artifact.version)}`,
      );
    }
  }
  return failures.length > 0 ? 'fail' : 'pass';
}

/**
 * Each pinned artifact must correspond to its declared source revision.
 *
 * A mismatch is a failure; an absent record is a gap. The declared pin comes from
 * the declaration, never from the record being checked.
 */
function pinnedCorrespondence(
  correspondence: readonly unknown[],
  failures: string[],
  gaps: string[],
  observations: Record<string, unknown>,
): Verdict {
  if (correspondence.length === 0) {
    gaps.push('no artifact/source correspondence was recorded');
    return 'inconclusive';
  }
  const seen = new Set<string>();
  let verdict: Verdict = 'pass';
  for (const entry of correspondence) {
    if (!isRecord(entry)) {
      gaps.push('a correspondence record is not an object');
      verdict = worse(verdict, 'inconclusive');
      continue;
    }
    const artifact = entry['artifact'];
    const version = entry['version'];
    if (!isNonEmptyString(artifact)) {
      gaps.push('a correspondence record names no artifact');
      verdict = worse(verdict, 'inconclusive');
      continue;
    }
    const key = `${artifact}@${String(version)}`;
    if (seen.has(key)) {
      failures.push(`duplicate artifact/source correspondence records: ${key}`);
      verdict = 'fail';
      continue;
    }
    seen.add(key);
    const pinnedRevision = entry['pinnedRevision'];
    const artifactRevision = entry['artifactRevision'];
    const matches = entry['matches'];
    if (!isNonEmptyString(pinnedRevision) || !isNonEmptyString(artifactRevision)) {
      gaps.push(`${key}: the correspondence record does not record both revisions`);
      verdict = worse(verdict, 'inconclusive');
      continue;
    }
    if (pinnedRevision !== artifactRevision || matches !== true) {
      // A boolean saying "matches" is not a substitute for the revisions agreeing.
      failures.push(
        `${key}: correspondence mismatch, pinned ${pinnedRevision} but the artifact is ${artifactRevision}`,
      );
      verdict = 'fail';
    }
  }
  observations['correspondenceRecords'] = Array.from(seen).sort();
  return verdict;
}
