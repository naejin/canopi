use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Settings {
    pub locale: Locale,
    pub theme: Theme,
    pub grid_size_m: f32,
    pub snap_to_grid: bool,
    pub snap_to_guides: bool,
    pub show_smart_guides: bool,
    pub auto_save_interval_s: u32,
    pub confirm_destructive: bool,
    pub default_currency: String,
    pub measurement_units: String,
    pub show_botanical_names: bool,
    pub debug_logging: bool,
    pub check_updates: bool,
    pub default_design_dir: String,
    pub recent_files_max: u32,
    pub last_active_panel: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            locale: Locale::En,
            theme: Theme::Light,
            grid_size_m: 1.0,
            snap_to_grid: true,
            snap_to_guides: true,
            show_smart_guides: true,
            auto_save_interval_s: 60,
            confirm_destructive: true,
            default_currency: "EUR".into(),
            measurement_units: "metric".into(),
            show_botanical_names: true,
            debug_logging: false,
            check_updates: true,
            default_design_dir: String::new(),
            recent_files_max: 20,
            last_active_panel: "plant-db".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    Fr,
    Es,
    Pt,
    It,
    Zh,
    De,
    Ja,
    Ko,
    Nl,
    Ru,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}
