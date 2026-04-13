// Mirror of common-types/src/settings.rs — keep in sync with Rust types

export interface Settings {
  locale: Locale
  theme: Theme
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
  bottom_panel_open: boolean
  bottom_panel_height: number
  bottom_panel_tab: string
  map_layer_visible: boolean
  map_style: string
  map_opacity: number
  contour_visible: boolean
  contour_opacity: number
  contour_interval: number
  hillshade_visible: boolean
  hillshade_opacity: number
}

export type Locale = 'en' | 'fr' | 'es' | 'pt' | 'it' | 'zh' | 'de' | 'ja' | 'ko' | 'nl' | 'ru'
export type Theme = 'light' | 'dark'
