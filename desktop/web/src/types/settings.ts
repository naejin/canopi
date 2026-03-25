// Mirror of common-types/src/settings.rs — keep in sync with Rust types

export interface Settings {
  locale: Locale
  theme: Theme
  grid_size_m: number
  snap_to_grid: boolean
  snap_to_guides: boolean
  show_smart_guides: boolean
  auto_save_interval_s: number
  confirm_destructive: boolean
  default_currency: string
  measurement_units: string
  show_botanical_names: boolean
  debug_logging: boolean
  check_updates: boolean
  default_design_dir: string
  recent_files_max: number
  last_active_panel: string
}

export type Locale = 'en' | 'fr' | 'es' | 'pt' | 'it' | 'zh'
export type Theme = 'light' | 'dark' | 'system'
