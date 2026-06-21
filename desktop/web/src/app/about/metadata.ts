import tauriConfigText from '../../../../tauri.conf.json?raw'

type TauriAppConfig = {
  readonly version?: unknown
}

function readCanopiVersion(configText: string): string {
  const config = JSON.parse(configText) as TauriAppConfig
  if (typeof config.version !== 'string' || config.version.length === 0) {
    throw new Error('desktop/tauri.conf.json must define a non-empty version')
  }
  return config.version
}

export const CANOPI_VERSION = readCanopiVersion(tauriConfigText)
export const CANOPI_LICENSE = 'AGPL-3.0-only'
export const CANOPI_COPYRIGHT = 'Copyright 2026 Jean-Pierre Yin'
