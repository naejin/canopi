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
import { mapNumericTransport } from './numericTransport.js';
import { mapArtifactCorrespondence } from './artifactCorrespondence.js';
import { mapPreparation } from './preparation.js';
import { mapMembers } from './members.js';
import { mapValues } from './values.js';
import { mapCrs } from './crs.js';
import { mapCancellation, mapFailureInjection, mapTeardown } from './lifecycle.js';
import { mapHost } from './host.js';
import { mapResources } from './resources.js';
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
  ['Q-ART-1', legacy((context) => mapArtifactCorrespondence(context.byRole.get('q1')))],
  ['Q-LOCAL-1', legacy((context) => mapNumericTransport(context.byRole.get('q2'), [
    'reads-over-proposed-local-transport',
    'transport-ledger-corroborates-bytes',
    'no-single-request-returns-whole-artifact',
    'values-match-independent-reference',
    'validity-matches-reference-exactly',
    'window-size-within-contract-limit',
  ]))],
  ['Q-PREP-1', legacy((context) => mapPreparation(context.byRole.get('q3prepare')))],
  ['Q-MEMBER-1', legacy((context) => mapMembers(context.byRole.get('q3members')))],
  [
    'Q-VALUE-1',
    legacy((context) => mapValues(context.byRole.get('q2'), context.byRole.get('q4slope'))),
  ],
  ['Q-CRS-1', legacy((context) => mapCrs(context.byRole.get('q4crs')))],
  ['Q-CANCEL-1', legacy((context) => mapCancellation(context.byRole.get('q5lifecycle')))],
  ['Q-TEARDOWN-1', legacy((context) => mapTeardown(context.byRole.get('q5lifecycle')))],
  ['Q-FAILINJ-1', legacy((context) => mapFailureInjection(context.byRole.get('q5lifecycle')))],
  ['Q-HOST-1', legacy((context) => mapHost(context.byRole.get('host')))],
  ['Q-RES-1', legacy((context) => mapResources(context.byRole.get('q6resources')))],
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
