/**
 * The requirement-to-check registry.
 *
 * Every required obligation in the contract has exactly one entry here, and every
 * entry decides its assertions through the explicit check driver. There is no second
 * way to produce a requirement verdict: the mappings own provenance only, and the
 * driver owns evaluation, attribution and the conversion to the one reduction.
 *
 * `CHECK_INVENTORIES` is the declared inventory itself, so a coverage or drift test
 * can compare it with the requirement contract without executing a decision.
 */

import {
  checkedMapping,
  type MappingContext,
  type MappingProvenance,
  type MappingResult,
} from './mapping.js';
import { NUMERIC_CHECKS, NUMERIC_PROVENANCE } from './numericTransport.js';
import { ARTIFACT_CHECKS, ARTIFACT_PROVENANCE } from './artifactCorrespondence.js';
import { PREPARATION_CHECKS, PREPARATION_PROVENANCE } from './preparation.js';
import { MEMBER_CHECKS, MEMBER_PROVENANCE } from './members.js';
import { VALUE_CHECKS, VALUE_PROVENANCE } from './values.js';
import { CRS_CHECKS, CRS_PROVENANCE } from './crs.js';
import {
  CANCEL_CHECKS,
  CANCEL_PROVENANCE,
  FAILURE_INJECTION_CHECKS,
  FAILURE_INJECTION_PROVENANCE,
  TEARDOWN_CHECKS,
  TEARDOWN_PROVENANCE,
} from './lifecycle.js';
import { HOST_CHECKS, HOST_PROVENANCE } from './host.js';
import { RESOURCE_CHECKS, RESOURCE_PROVENANCE } from './resources.js';
import { DISPLAY_CHECKS, DISPLAY_PROVENANCE } from './display.js';
import type { RequirementChecks } from './checks.js';

export type RequirementMapping = (context: MappingContext) => MappingResult;

const REQUIREMENTS: readonly (readonly [RequirementChecks, MappingProvenance])[] = [
  [ARTIFACT_CHECKS, ARTIFACT_PROVENANCE],
  [NUMERIC_CHECKS, NUMERIC_PROVENANCE],
  [PREPARATION_CHECKS, PREPARATION_PROVENANCE],
  [MEMBER_CHECKS, MEMBER_PROVENANCE],
  [VALUE_CHECKS, VALUE_PROVENANCE],
  [CRS_CHECKS, CRS_PROVENANCE],
  [CANCEL_CHECKS, CANCEL_PROVENANCE],
  [TEARDOWN_CHECKS, TEARDOWN_PROVENANCE],
  [FAILURE_INJECTION_CHECKS, FAILURE_INJECTION_PROVENANCE],
  [HOST_CHECKS, HOST_PROVENANCE],
  [RESOURCE_CHECKS, RESOURCE_PROVENANCE],
  [DISPLAY_CHECKS, DISPLAY_PROVENANCE],
];

/** The declared check inventory for every requirement. */
export const CHECK_INVENTORIES: ReadonlyMap<string, RequirementChecks> = new Map(
  REQUIREMENTS.map(([spec]) => [spec.requirementId, spec]),
);

export const MAPPINGS: ReadonlyMap<string, RequirementMapping> = new Map(
  REQUIREMENTS.map(([spec, provenance]) => [spec.requirementId, checkedMapping(spec, provenance)]),
);
