/**
 * Declaration profiles.
 *
 * A profile is explicit launcher input: it names the host and environment the run
 * declares, and the roles that only exist in that environment. It is never read from
 * report identity, so a report cannot choose what it is checked against, and an
 * unknown profile is rejected rather than defaulted.
 *
 * The scientific requirements do not change between profiles. `desktop-local` keeps
 * the route id, the candidate versions and pins, and the required `local-bridge`
 * transport; it changes which host is declared and adds the host report role. A
 * Chromium report therefore cannot satisfy `desktop-local` by declaration alone: its
 * own recorded host conflicts with the declared one.
 */

// Read only inside `profiles()`: this module is imported by `route.ts`, so touching
// those constants during module initialisation would be a use-before-initialisation.
import {
  QUALIFICATION_ENVIRONMENT_ID,
  QUALIFICATION_HOST,
} from './route.js';

export const QUALIFICATION_PROFILES = ['chromium', 'desktop-local'] as const;
export type QualificationProfile = (typeof QUALIFICATION_PROFILES)[number];

/** The profile a run uses when the caller names none. */
export const DEFAULT_PROFILE: QualificationProfile = 'chromium';

/** A role that exists only in one profile. */
export interface ProfileRole {
  readonly role: string;
  readonly experiment: string;
  readonly reportFile: string;
  readonly artifact?: { readonly name: string; readonly version: string };
  /** Why the artifact carries no pinned source revision. */
  readonly unpinnedReason?: string;
}

export interface ProfileDeclaration {
  readonly profile: QualificationProfile;
  readonly environment: string;
  readonly host: string;
  /** Hosts a report in this profile may record. */
  readonly acceptedHosts: readonly string[];
  /** Roles this profile adds to the default role set. */
  readonly extraRoles: readonly ProfileRole[];
  readonly description: string;
}

let cached: ReadonlyMap<QualificationProfile, ProfileDeclaration> | undefined;

/**
 * The declarations, built on first use.
 *
 * Built lazily on purpose: `route.ts` imports this module for the default profile,
 * so reading its constants during module initialisation would create an import cycle.
 */
function profiles(): ReadonlyMap<QualificationProfile, ProfileDeclaration> {
  cached ??= new Map<QualificationProfile, ProfileDeclaration>([
  [
    'chromium',
    {
      profile: 'chromium',
      environment: QUALIFICATION_ENVIRONMENT_ID,
      host: QUALIFICATION_HOST,
      acceptedHosts: ['chromium'],
      extraRoles: [],
      description: 'Browser-hosted Chromium probe profile; the default.',
    },
  ],
  [
    'desktop-local',
    {
      profile: 'desktop-local',
      environment: 'qualification-host-desktop-local-v1',
      host: 'desktop-webview',
      acceptedHosts: ['desktop-webview'],
      extraRoles: [
        {
          role: 'host',
          experiment: 'q-host',
          reportFile: 'host.json',
          artifact: { name: 'desktop-webview', version: 'bundled' },
          unpinnedReason:
            'the WebView platform runtime is the measured host, not an npm engine, so it has no pinned source revision',
        },
      ],
      description: 'Bundled Desktop WebView host profile.',
    },
  ],
  ]);
  return cached;
}

export function isQualificationProfile(value: unknown): value is QualificationProfile {
  return typeof value === 'string' && (QUALIFICATION_PROFILES as readonly string[]).includes(value);
}

/** The declaration for a profile, defaulting to the current Chromium profile. */
export function profileDeclaration(
  profile: QualificationProfile = DEFAULT_PROFILE,
): ProfileDeclaration {
  const declaration = profiles().get(profile);
  if (declaration === undefined) {
    throw new Error(`unknown qualification profile ${JSON.stringify(profile)}`);
  }
  return declaration;
}

/** The extra role a profile declares, if it declares that role. */
export function profileRole(
  profile: QualificationProfile,
  role: string,
): ProfileRole | undefined {
  return profileDeclaration(profile).extraRoles.find((entry) => entry.role === role);
}
