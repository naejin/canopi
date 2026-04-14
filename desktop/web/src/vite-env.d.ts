/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY?: string
  readonly VITE_CANOPI_UPDATER_ENABLED?: string
  readonly VITE_CANOPI_UPDATER_STABLE_ENDPOINT?: string
  readonly VITE_CANOPI_UPDATER_BETA_ENDPOINT?: string
}
