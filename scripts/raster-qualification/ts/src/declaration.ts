/**
 * Declarations are inputs.
 *
 * The requirement contract, the fixture manifest and the candidate pins are all
 * supplied by a caller, so none of them may be assumed valid. They are validated
 * before anything is indexed from them, because a Map or a Set built from an
 * unvalidated declaration lets a duplicate or a malformed entry decide the
 * outcome silently.
 *
 * A missing declaration is a gap; a present but malformed one is a failure. The
 * two are never collapsed, because they call for different operator action.
 */

import {
  asArray,
  describe,
  isNonEmptyString,
  isRecord,
  nonNegativeInteger,
} from './fields.js';

export interface RequirementSpec {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly required: boolean;
  readonly role: string;
  readonly assertions: readonly string[];
  readonly requiresRasterFixture: boolean;
  readonly fixtureClass?: string;
  readonly evidenceSource?: string;
  readonly planBasis?: string;
  readonly unitsOrBudget?: string;
  readonly hostEvidenceRules?: Record<string, unknown>;
}

export interface Contract {
  readonly contractVersion: number;
  readonly source: string;
  readonly title: string;
  readonly requirements: readonly RequirementSpec[];
}

export interface Validation<T> {
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  /** Usable only when the verdict is `pass`. */
  readonly value?: T;
  readonly problems: readonly string[];
}

const DECLARATION_PREFIX = 'invalid declaration: ';

function ok<T>(value: T): Validation<T> {
  return { verdict: 'pass', value, problems: [] };
}

function failed<T>(problems: readonly string[]): Validation<T> {
  return { verdict: 'fail', problems };
}

function gap<T>(problems: readonly string[]): Validation<T> {
  return { verdict: 'inconclusive', problems };
}

/**
 * Validate the authoring contract before any obligation is read from it.
 *
 * This does not create obligations and does not reorder them: the contract remains
 * the executable set. It only refuses to build a verdict engine from a contract
 * whose structure would make `required` or `assertions` mean something unintended.
 */
export function validateContract(value: unknown, label: string): Validation<Contract> {
  if (value === undefined || value === null) {
    return gap([`no requirement contract was supplied for ${label}`]);
  }
  if (!isRecord(value)) {
    return failed([`${DECLARATION_PREFIX}${label} is ${describe(value)}, not an object`]);
  }
  const problems: string[] = [];

  const rawVersion = value['contractVersion'];
  const contractVersion = nonNegativeInteger(rawVersion);
  if (rawVersion === undefined) {
    problems.push(`${label} records no contractVersion`);
  } else if (contractVersion === undefined) {
    problems.push(`${label} records a malformed contractVersion ${describe(rawVersion)}`);
  } else if (contractVersion !== 1) {
    // An unsupported version cannot be interpreted: a later contract may add a
    // field whose absence here would read as a gap rather than as a mismatch.
    problems.push(`${label} declares unsupported contractVersion ${contractVersion}`);
  }

  const source = value['source'];
  if (!isNonEmptyString(source)) {
    problems.push(`${label} records no source identity`);
  }

  const requirementsValue = value['requirements'];
  const requirementList = asArray(requirementsValue);
  if (requirementsValue === undefined) {
    return gap([`${label} declares no requirements`]);
  }
  if (requirementList === undefined) {
    return failed([
      `${DECLARATION_PREFIX}${label} requirements are ${describe(requirementsValue)}, not a list`,
    ]);
  }
  if (requirementList.length === 0) {
    return gap([`${label} declares no requirements`]);
  }

  const seenIds = new Set<string>();
  const requirements: RequirementSpec[] = [];
  requirementList.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`${DECLARATION_PREFIX}requirement ${index} is ${describe(entry)}, not an object`);
      return;
    }
    const id = entry['id'];
    if (!isNonEmptyString(id)) {
      problems.push(`${DECLARATION_PREFIX}requirement ${index} has no usable id`);
      return;
    }
    if (seenIds.has(id)) {
      problems.push(`${DECLARATION_PREFIX}repeats requirement id ${JSON.stringify(id)}`);
      return;
    }
    seenIds.add(id);

    const required = entry['required'];
    if (typeof required !== 'boolean') {
      // `required` decides whether an obligation is enforced. A truthy string here
      // would silently change what counts as mandatory.
      problems.push(
        `${DECLARATION_PREFIX}requirement ${id} records required=${describe(required)}, not a boolean`,
      );
      return;
    }

    const assertionsValue = entry['assertions'];
    const assertionList = asArray(assertionsValue);
    if (assertionList === undefined) {
      problems.push(
        `${DECLARATION_PREFIX}requirement ${id} assertions are ${describe(assertionsValue)}, not a list`,
      );
      return;
    }
    const assertionIds: string[] = [];
    const seenAssertions = new Set<string>();
    for (const assertion of assertionList) {
      if (!isNonEmptyString(assertion)) {
        problems.push(
          `${DECLARATION_PREFIX}requirement ${id} names ${describe(assertion)} as an assertion`,
        );
        continue;
      }
      if (seenAssertions.has(assertion)) {
        problems.push(
          `${DECLARATION_PREFIX}requirement ${id} repeats assertion ${JSON.stringify(assertion)}`,
        );
        continue;
      }
      seenAssertions.add(assertion);
      assertionIds.push(assertion);
    }
    if (assertionIds.length === 0) {
      problems.push(`${DECLARATION_PREFIX}requirement ${id} declares no assertions`);
      return;
    }

    const requiresRaster = entry['requiresRasterFixture'];
    if (typeof requiresRaster !== 'boolean') {
      problems.push(
        `${DECLARATION_PREFIX}requirement ${id} records requiresRasterFixture=${describe(requiresRaster)}, not a boolean`,
      );
      return;
    }
    if (requiresRaster === false && !isNonEmptyString(entry['noFixtureReason'])) {
      // A requirement excused from raster evidence must say why, or the exemption
      // is indistinguishable from a missing flag.
      problems.push(
        `${DECLARATION_PREFIX}requirement ${id} waives the raster fixture without a reason`,
      );
      return;
    }

    const title = entry['title'];
    const phase = entry['phase'];
    const role = entry['role'];
    if (!isNonEmptyString(title) || !isNonEmptyString(phase) || !isNonEmptyString(role)) {
      problems.push(
        `${DECLARATION_PREFIX}requirement ${id} is missing its title, phase or role label`,
      );
      return;
    }

    const spec: RequirementSpec = {
      id,
      title,
      phase,
      required,
      role,
      assertions: assertionIds,
      requiresRasterFixture: requiresRaster,
      ...(isNonEmptyString(entry['fixtureClass']) ? { fixtureClass: entry['fixtureClass'] } : {}),
      ...(isNonEmptyString(entry['evidenceSource']) ? { evidenceSource: entry['evidenceSource'] } : {}),
      ...(isNonEmptyString(entry['planBasis']) ? { planBasis: entry['planBasis'] } : {}),
      ...(isNonEmptyString(entry['unitsOrBudget']) ? { unitsOrBudget: entry['unitsOrBudget'] } : {}),
      ...(isRecord(entry['hostEvidenceRules']) ? { hostEvidenceRules: entry['hostEvidenceRules'] } : {}),
    };
    requirements.push(spec);
  });

  if (problems.length > 0) return failed(problems);
  return ok({
    contractVersion: contractVersion ?? 1,
    source: isNonEmptyString(source) ? source : label,
    title: isNonEmptyString(value['title']) ? value['title'] : label,
    requirements,
  });
}

export interface FixtureMember {
  readonly name: string;
  readonly sha256: string;
}

export interface FixtureManifest {
  readonly declared: readonly FixtureMember[];
  /** role -> fixture names that role must cover. `*` means every role. */
  readonly requiredByRole: ReadonlyMap<string, readonly string[]>;
}

/** A well-formed SHA-256 hex digest, either case. */
export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Validate the fixture manifest before any fixture identity is indexed.
 *
 * A missing hash is a gap; a hash that cannot be a hash, a duplicate name, an
 * undeclared required reference or an explicitly empty required list is a
 * failure. An empty required list would otherwise read as "this role needs no
 * raster evidence", which is the opposite of what the plan requires.
 */
export function validateFixtureManifest(value: unknown, label: string): Validation<FixtureManifest> {
  if (value === undefined || value === null) {
    return gap(['no fixture manifest was supplied, so fixture coverage cannot be established']);
  }
  if (!isRecord(value)) {
    return failed([`${DECLARATION_PREFIX}${label} is ${describe(value)}, not an object`]);
  }
  const declaredValue = value['declared'];
  if (declaredValue === undefined) {
    return failed([`${DECLARATION_PREFIX}${label} records no declared fixtures`]);
  }
  const declaredList = asArray(declaredValue);
  if (declaredList === undefined) {
    return failed([
      `${DECLARATION_PREFIX}${label} declared fixtures are ${describe(declaredValue)}, not a list`,
    ]);
  }
  if (declaredList.length === 0) {
    return gap([`${label} declares no fixtures`]);
  }

  const problems: string[] = [];
  const gaps: string[] = [];
  const members = new Map<string, string>();
  declaredList.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`${DECLARATION_PREFIX}declared member ${index} is ${describe(entry)}, not an object`);
      return;
    }
    const name = entry['name'];
    if (!isNonEmptyString(name)) {
      problems.push(`${DECLARATION_PREFIX}declared member ${index} has no usable name`);
      return;
    }
    const hash = entry['sha256'];
    if (hash === undefined || hash === null) {
      gaps.push(`declared fixture ${JSON.stringify(name)} records no hash, so its identity is incomplete`);
      return;
    }
    if (!isSha256(hash)) {
      problems.push(
        `${DECLARATION_PREFIX}declared fixture ${JSON.stringify(name)} records a malformed sha256 ${describe(hash)}`,
      );
      return;
    }
    const previous = members.get(name);
    if (previous !== undefined) {
      const detail =
        previous === hash
          ? `both record ${hash}`
          : `one records ${previous}, another records ${hash}`;
      problems.push(
        `${DECLARATION_PREFIX}repeats declared fixture ${JSON.stringify(name)}: ${detail}`,
      );
      return;
    }
    members.set(name, hash);
  });

  const requiredByRole = new Map<string, readonly string[]>();
  const rolesValue = value['requiredFixtures'];
  if (rolesValue === undefined || rolesValue === null) {
    requiredByRole.set('*', Array.from(members.keys()));
  } else if (!isRecord(rolesValue)) {
    problems.push(
      `${DECLARATION_PREFIX}${label} requiredFixtures is ${describe(rolesValue)}, not an object`,
    );
  } else {
    for (const [role, required] of Object.entries(rolesValue)) {
      if (!isNonEmptyString(role)) {
        problems.push(`${DECLARATION_PREFIX}requiredFixtures has a role without a name`);
        continue;
      }
      const list = asArray(required);
      if (list === undefined) {
        problems.push(
          `${DECLARATION_PREFIX}required fixture list for ${JSON.stringify(role)} is ${describe(required)}, not a list`,
        );
        continue;
      }
      if (list.length === 0) {
        problems.push(
          `${DECLARATION_PREFIX}required fixture list for ${JSON.stringify(role)} is empty, which cannot waive that role's raster evidence`,
        );
        continue;
      }
      const resolved: string[] = [];
      for (const entry of list) {
        if (!isNonEmptyString(entry)) {
          problems.push(
            `${DECLARATION_PREFIX}required fixture list for ${JSON.stringify(role)} contains ${describe(entry)}`,
          );
          continue;
        }
        if (!members.has(entry)) {
          problems.push(
            `${DECLARATION_PREFIX}required fixture ${JSON.stringify(entry)} for ${JSON.stringify(role)} is not declared`,
          );
          continue;
        }
        resolved.push(entry);
      }
      requiredByRole.set(role, resolved);
    }
    if (!requiredByRole.has('*')) {
      requiredByRole.set('*', Array.from(members.keys()));
    }
  }

  if (problems.length > 0) return failed(problems);
  if (gaps.length > 0) return gap(gaps);
  return ok({ declared: Array.from(members, ([name, sha256]) => ({ name, sha256 })), requiredByRole });
}

export interface PinDeclaration {
  readonly contracts: ReadonlyMap<string, string>;
}

/**
 * Validate the declared candidate pins before they are indexed by name.
 *
 * The same class of defect the fixture manifest is checked for applies here: a
 * repeated pin name would let whichever revision was written last silently become
 * the expectation.
 */
export function validatePinDeclaration(value: unknown, label: string): Validation<PinDeclaration> {
  if (value === undefined || value === null) {
    return gap([`no candidate pin declaration was supplied for ${label}`]);
  }
  if (!isRecord(value)) {
    return failed([`${DECLARATION_PREFIX}${label} is ${describe(value)}, not an object`]);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return gap([`${label} records no candidate pins`]);
  }
  const problems: string[] = [];
  const gaps: string[] = [];
  const contracts = new Map<string, string>();
  for (const [name, revision] of entries) {
    if (!isNonEmptyString(name)) {
      problems.push(`${DECLARATION_PREFIX}${label} has a pin without a name`);
      continue;
    }
    if (revision === undefined || revision === null) {
      gaps.push(`${label} records no revision for ${JSON.stringify(name)}`);
      continue;
    }
    if (!isNonEmptyString(revision)) {
      problems.push(
        `${DECLARATION_PREFIX}${label} records a malformed pin for ${JSON.stringify(name)}: ${describe(revision)}`,
      );
      continue;
    }
    contracts.set(name, revision);
  }
  if (problems.length > 0) return failed(problems);
  if (gaps.length > 0) return gap(gaps);
  return ok({ contracts });
}
