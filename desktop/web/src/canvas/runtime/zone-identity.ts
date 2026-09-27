import { createUuid } from '../../utils/ids'

/**
 * A new zone's stable identity. Targets, groups and saved views refer to it;
 * the interface never shows it. The display name is separate (`name`).
 */
export function newZoneId(): string {
  return `zone-${createUuid()}`
}

/** The name the user gave a zone, or null while it has none (a blank name is none). */
export function zoneDisplayName(zone: { readonly name: string | null }): string | null {
  const name = zone.name?.trim() ?? ''
  return name.length > 0 ? name : null
}
