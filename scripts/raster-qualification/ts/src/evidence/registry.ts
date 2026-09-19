/**
 * The requirement-to-mapping registry.
 *
 * Every required obligation in the contract has exactly one mapping here. A
 * requirement with no mapping is reported as an explicit gap by the caller rather
 * than being silently skipped, so a missing mapping can never read as a pass.
 *
 * Each mapping declares which source roles it draws on. The decision then requires
 * every one of those sources to have been admitted, so a requirement cannot be
 * carried by the passing sources alone.
 */

import { checkedMapping, type MappingContext, type MappingResult } from './mapping.js';
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

export type RequirementMapping = (context: MappingContext) => MappingResult;

/**
 * How a requirement's assertions are decided during the migration.
 *
 * `checked` entries use the explicit check driver and are the target shape.
 * `legacy` entries still write their own verdicts; the tag is internal and
 * temporary, and the final coverage test forbids it once every requirement is
 * migrated. A requirement is one or the other, never both.
 */
export type RegistryEntry =
  | { readonly kind: 'checked'; readonly mapping: RequirementMapping }
  | { readonly kind: 'legacy'; readonly mapping: RequirementMapping };

function legacy(mapping: RequirementMapping): RegistryEntry {
  return { kind: 'legacy', mapping };
}

export const MAPPINGS: ReadonlyMap<string, RegistryEntry> = new Map<string, RegistryEntry>([
  ['Q-ART-1', { kind: 'checked', mapping: checkedMapping(ARTIFACT_CHECKS, ARTIFACT_PROVENANCE) }],
  ['Q-LOCAL-1', { kind: 'checked', mapping: checkedMapping(NUMERIC_CHECKS, NUMERIC_PROVENANCE) }],
  ['Q-PREP-1', { kind: 'checked', mapping: checkedMapping(PREPARATION_CHECKS, PREPARATION_PROVENANCE) }],
  ['Q-MEMBER-1', { kind: 'checked', mapping: checkedMapping(MEMBER_CHECKS, MEMBER_PROVENANCE) }],
  ['Q-VALUE-1', { kind: 'checked', mapping: checkedMapping(VALUE_CHECKS, VALUE_PROVENANCE) }],
  ['Q-CRS-1', { kind: 'checked', mapping: checkedMapping(CRS_CHECKS, CRS_PROVENANCE) }],
  ['Q-CANCEL-1', { kind: 'checked', mapping: checkedMapping(CANCEL_CHECKS, CANCEL_PROVENANCE) }],
  [
    'Q-TEARDOWN-1',
    { kind: 'checked', mapping: checkedMapping(TEARDOWN_CHECKS, TEARDOWN_PROVENANCE) },
  ],
  [
    'Q-FAILINJ-1',
    { kind: 'checked', mapping: checkedMapping(FAILURE_INJECTION_CHECKS, FAILURE_INJECTION_PROVENANCE) },
  ],
  ['Q-HOST-1', { kind: 'checked', mapping: checkedMapping(HOST_CHECKS, HOST_PROVENANCE) }],
  ['Q-RES-1', { kind: 'checked', mapping: checkedMapping(RESOURCE_CHECKS, RESOURCE_PROVENANCE) }],
  ['Q-DISPLAY-1', { kind: 'checked', mapping: checkedMapping(DISPLAY_CHECKS, DISPLAY_PROVENANCE) }],
]);

/** Requirements whose assertions the explicit check driver decides. */
export const CHECKED_REQUIREMENTS: readonly string[] = Array.from(MAPPINGS)
  .filter(([, entry]) => entry.kind === 'checked')
  .map(([id]) => id);

/** Requirements still decided by their own legacy mapping. */
export const LEGACY_REQUIREMENTS: readonly string[] = Array.from(MAPPINGS)
  .filter(([, entry]) => entry.kind === 'legacy')
  .map(([id]) => id);
