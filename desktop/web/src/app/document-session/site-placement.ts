import { CanopiDesignNeedsSiteError } from "../contracts/canopi-design-errors";
import type { DesignLoadOutcome, GeoPoint, LoadedDesign, PendingDesignSite } from "../../types/design";
import type { DocumentTransitionLoadResult } from "./state-machine";

/**
 * Asks "Where is your site?" for a pre-geolocation Design and resolves to the
 * chosen point, or null when the user declines. Registered by the interface
 * that owns the prompt; without one, such a Design cannot open and the load
 * fails with `CanopiDesignNeedsSiteError`.
 */
export type DesignSiteResolver = (pending: PendingDesignSite) => Promise<GeoPoint | null>;

let resolver: DesignSiteResolver | null = null;

export function registerDesignSiteResolver(next: DesignSiteResolver | null): void {
  resolver = next;
}

/** Thrown when the user declines to place a pending Design; the transition is cancelled. */
export class DesignSitePlacementCancelledError extends Error {
  constructor() {
    super("Site placement cancelled");
    this.name = "DesignSitePlacementCancelledError";
  }
}

/**
 * Turn a native load outcome into the document a transition applies. A
 * current or migrated Design is ready; a pending one goes through the site
 * resolver and `placeAtSite` (which the native side runs), so nothing is
 * written before the user picks.
 */
export async function resolveDesignLoadOutcome(
  outcome: DesignLoadOutcome,
  path: string,
  placeAtSite: (pending: PendingDesignSite, site: GeoPoint, fingerprint: string) => Promise<LoadedDesign>,
): Promise<DocumentTransitionLoadResult> {
  if (outcome.kind === "loaded") return loadResult(outcome.design, path);
  if (!resolver) throw new CanopiDesignNeedsSiteError(outcome.pending);
  const site = await resolver(outcome.pending);
  if (!site) throw new DesignSitePlacementCancelledError();
  return loadResult(await placeAtSite(outcome.pending, site, outcome.fingerprint), path);
}

function loadResult(design: LoadedDesign, path: string): DocumentTransitionLoadResult {
  return {
    file: design.file,
    path,
    name: design.file.name,
    fingerprint: design.fingerprint,
    migratedFrom: design.migrated_from ?? null,
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resolver = null;
  });
}
