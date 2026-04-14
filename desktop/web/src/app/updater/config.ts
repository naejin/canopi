import type { UpdateChannel } from '../../types/settings'

const stableEndpoint = import.meta.env.VITE_CANOPI_UPDATER_STABLE_ENDPOINT?.trim() ?? ''
const betaEndpoint = import.meta.env.VITE_CANOPI_UPDATER_BETA_ENDPOINT?.trim() ?? ''

export const updaterConfigured = stableEndpoint.length > 0 && betaEndpoint.length > 0

export const updaterEnabled =
  import.meta.env.VITE_CANOPI_UPDATER_ENABLED === 'true' &&
  updaterConfigured

export const updaterControlsVisible = import.meta.env.DEV || updaterEnabled

export const UPDATE_CHANNELS = ['stable', 'beta'] as const satisfies readonly UpdateChannel[]

export function getUpdaterEndpoints(channel: UpdateChannel): string[] {
  const endpoint = channel === 'beta' ? betaEndpoint : stableEndpoint
  return endpoint ? [endpoint] : []
}
