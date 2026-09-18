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

import type { MappingContext, MappingResult } from './mapping.js';
import { mapNumericTransport } from './numericTransport.js';
import { mapArtifactCorrespondence } from './artifactCorrespondence.js';
import { mapPreparation } from './preparation.js';
import { mapMembers } from './members.js';
import { mapValues } from './values.js';
import { mapCrs } from './crs.js';
import { mapCancellation, mapFailureInjection, mapTeardown } from './lifecycle.js';
import { mapHost } from './host.js';
import { mapResources } from './resources.js';
import { mapDisplay } from './display.js';

export type RequirementMapping = (context: MappingContext) => MappingResult;

export const MAPPINGS: ReadonlyMap<string, RequirementMapping> = new Map<string, RequirementMapping>([
  ['Q-ART-1', (context) => mapArtifactCorrespondence(context.byRole.get('q1'))],
  ['Q-LOCAL-1', (context) => mapNumericTransport(context.byRole.get('q2'), [
    'reads-over-proposed-local-transport',
    'transport-ledger-corroborates-bytes',
    'no-single-request-returns-whole-artifact',
    'values-match-independent-reference',
    'validity-matches-reference-exactly',
    'window-size-within-contract-limit',
  ])],
  ['Q-PREP-1', (context) => mapPreparation(context.byRole.get('q3prepare'))],
  ['Q-MEMBER-1', (context) => mapMembers(context.byRole.get('q3members'))],
  [
    'Q-VALUE-1',
    (context) => mapValues(context.byRole.get('q2'), context.byRole.get('q4slope')),
  ],
  ['Q-CRS-1', (context) => mapCrs(context.byRole.get('q4crs'))],
  ['Q-CANCEL-1', (context) => mapCancellation(context.byRole.get('q5lifecycle'))],
  ['Q-TEARDOWN-1', (context) => mapTeardown(context.byRole.get('q5lifecycle'))],
  ['Q-FAILINJ-1', (context) => mapFailureInjection(context.byRole.get('q5lifecycle'))],
  ['Q-HOST-1', (context) => mapHost(context.byRole.get('host'))],
  ['Q-RES-1', (context) => mapResources(context.byRole.get('q6resources'))],
  ['Q-DISPLAY-1', (context) => mapDisplay(context.byRole.get('trace'))],
]);
