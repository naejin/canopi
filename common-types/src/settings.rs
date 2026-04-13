use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(default)]
pub struct Settings {
    pub locale: Locale,
    pub theme: Theme,
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
    pub bottom_panel_open: bool,
    pub bottom_panel_height: u32,
    pub bottom_panel_tab: String,
    pub map_layer_visible: bool,
    pub map_style: String,
    pub map_opacity: f32,
    pub contour_visible: bool,
    pub contour_opacity: f32,
    pub contour_interval: u32,
    pub hillshade_visible: bool,
    pub hillshade_opacity: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            locale: Locale::En,
            theme: Theme::Light,
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
            bottom_panel_open: false,
            bottom_panel_height: 200,
            bottom_panel_tab: "budget".into(),
            map_layer_visible: true,
            map_style: "street".into(),
            map_opacity: 1.0,
            contour_visible: false,
            contour_opacity: 1.0,
            contour_interval: 0,
            hillshade_visible: false,
            hillshade_opacity: 0.55,
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
