import { createUuid } from '../../utils/ids'

const GENERATED_ZONE_NAME = /^(?:zone-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?: copy(?: \d+)?)?$/i

/**
 * A drawn zone's name. A zone's name is also its identity; until the user
 * names it, it is this generated id, which the interface never shows.
 */
export function generatedZoneName(): string {
  return `zone-${createUuid()}`
}

/**
 * Whether a zone's name is only its generated identity (`zone-<uuid>`, a
 * pasted copy of one, or a bare uuid), not a name the user gave.
 */
export function isGeneratedZoneName(name: string): boolean {
  return GENERATED_ZONE_NAME.test(name)
}
