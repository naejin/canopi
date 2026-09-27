/** One species photo with whatever attribution its catalog records. */
export interface SpeciesPhoto {
  readonly url: string
  readonly source: string | null
  /** A page about the photo; linked only where the edition can open links. */
  readonly sourcePageUrl: string | null
  readonly credit: string | null
  readonly license: string | null
}

const KNOWN_SOURCES: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)wikimedia\.org$/, 'Wikimedia Commons'],
  [/(^|\.)inaturalist\.org$|^inaturalist-open-data\.s3\.amazonaws\.com$/, 'iNaturalist'],
]

/**
 * The Desktop plant DB records only a photo's address. Name its host as the source
 * ("Wikimedia Commons", "iNaturalist", or the host itself); credit and license stay
 * unrecorded rather than guessed.
 */
export function photoFromCatalogUrl(url: string): SpeciesPhoto {
  let host: string | null = null
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    host = null
  }
  const known = host === null ? undefined : KNOWN_SOURCES.find(([pattern]) => pattern.test(host!))
  return {
    url,
    source: known?.[1] ?? host,
    sourcePageUrl: null,
    credit: null,
    license: null,
  }
}
