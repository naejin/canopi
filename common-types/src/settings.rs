use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(default)]
pub struct Settings {
    pub locale: Locale,
    pub theme: Theme,
    pub snap_to_grid: bool,
    pub snap_to_guides: bool,
    pub auto_save_interval_s: u32,
    pub side_panel_width: Option<u32>,
    pub saved_stamps_frame_height: Option<u32>,
    pub bottom_panel_open: bool,
    pub bottom_panel_timeline_height: Option<u32>,
    pub bottom_panel_budget_height: Option<u32>,
    pub bottom_panel_consortium_height: Option<u32>,
    pub bottom_panel_tab: String,
    pub map_layer_visible: bool,
    #[serde(deserialize_with = "deserialize_basemap_style")]
    pub map_style: BasemapStyle,
    pub map_opacity: f32,
    pub contour_visible: bool,
    pub contour_opacity: f32,
    pub contour_interval: u32,
    pub hillshade_visible: bool,
    pub hillshade_opacity: f32,
    #[serde(default = "default_plant_spacing_interval_m")]
    pub plant_spacing_interval_m: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            locale: Locale::En,
            theme: Theme::Light,
            snap_to_grid: true,
            snap_to_guides: true,
            auto_save_interval_s: 60,
            side_panel_width: None,
            saved_stamps_frame_height: None,
            bottom_panel_open: false,
            bottom_panel_timeline_height: None,
            bottom_panel_budget_height: None,
            bottom_panel_consortium_height: None,
            bottom_panel_tab: "budget".into(),
            map_layer_visible: true,
            map_style: BasemapStyle::Street,
            map_opacity: 1.0,
            contour_visible: false,
            contour_opacity: 1.0,
            contour_interval: 0,
            hillshade_visible: false,
            hillshade_opacity: 0.55,
            plant_spacing_interval_m: default_plant_spacing_interval_m(),
        }
    }
}

fn default_plant_spacing_interval_m() -> f64 {
    0.5
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum BasemapStyle {
    #[default]
    Street,
    Satellite,
}

fn deserialize_basemap_style<'de, D>(deserializer: D) -> Result<BasemapStyle, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer) {
        Ok(serde_json::Value::String(value)) if value == "satellite" => Ok(BasemapStyle::Satellite),
        Ok(serde_json::Value::String(_)) => Ok(BasemapStyle::Street),
        Ok(_) => Ok(BasemapStyle::Street),
        Err(_) => Ok(BasemapStyle::Street),
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

#[cfg(test)]
mod tests {
    use super::{Locale, Settings, Theme};

    #[test]
    fn legacy_unconsumed_keys_are_accepted_but_not_serialized() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "locale": "fr",
            "theme": "dark",
            "show_smart_guides": false,
            "confirm_destructive": false,
            "default_currency": "USD",
            "measurement_units": "imperial",
            "show_botanical_names": false,
            "debug_logging": true,
            "check_updates": false,
            "default_design_dir": "/legacy/designs",
            "recent_files_max": 99,
            "last_active_panel": "legacy-panel"
        }))
        .expect("legacy settings should remain readable");

        assert_eq!(settings.locale, Locale::Fr);
        assert_eq!(settings.theme, Theme::Dark);

        let serialized = serde_json::to_value(settings).expect("settings should serialize");
        for retired_key in [
            "show_smart_guides",
            "confirm_destructive",
            "default_currency",
            "measurement_units",
            "show_botanical_names",
            "debug_logging",
            "check_updates",
            "default_design_dir",
            "recent_files_max",
            "last_active_panel",
        ] {
            assert!(
                serialized.get(retired_key).is_none(),
                "retired key {retired_key} must not be emitted"
            );
        }
    }
}
