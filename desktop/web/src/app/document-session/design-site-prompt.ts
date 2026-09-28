import { computed, signal, type ReadonlySignal } from '@preact/signals'
import type { GeoPoint, PendingDesignSite } from '../../types/design'

/**
 * "Where is your site?" for a Design from before geolocation (ADR 0013). The
 * Desktop shell registers `requestDesignSite` as the site resolver; the card
 * over the map answers with the chosen point, or null when the user cancels.
 * Nothing here is Design state and nothing is written until the answer.
 */
interface ActiveDesignSitePrompt {
  readonly pending: PendingDesignSite
  readonly answer: (site: GeoPoint | null) => void
}

const active = signal<ActiveDesignSitePrompt | null>(null)

export const pendingDesignSitePrompt: ReadonlySignal<PendingDesignSite | null> = computed(
  () => active.value?.pending ?? null,
)

/** Show the card and resolve with the chosen site. A newer request cancels an older one. */
export function requestDesignSite(pending: PendingDesignSite): Promise<GeoPoint | null> {
  active.peek()?.answer(null)
  return new Promise((resolve) => {
    const prompt: ActiveDesignSitePrompt = {
      pending,
      answer: (site) => {
        if (active.peek() === prompt) active.value = null
        resolve(site)
      },
    }
    active.value = prompt
  })
}

export function answerDesignSite(site: GeoPoint | null): void {
  active.peek()?.answer(site)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    answerDesignSite(null)
  })
}
