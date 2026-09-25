use serde::{Deserialize, Serialize};
use specta::Type;

macro_rules! settings_enum {
    (
        $(#[$enum_attribute:meta])*
        $visibility:vis enum $name:ident {
            $(
                $(#[$variant_attribute:meta])*
                $variant:ident
            ),+ $(,)?
        }
    ) => {
        $(#[$enum_attribute])*
        $visibility enum $name {
            $(
                $(#[$variant_attribute])*
                $variant,
            )+
        }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
        }
    };
}

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
    /// OpenFreeMap vector style of the Basemap row.
    pub basemap_style: BasemapStyle,
    pub basemap_visible: bool,
    pub basemap_opacity: f32,
    /// Whether the Google satellite row is on; it hides the Basemap when on.
    pub satellite_visible: bool,
    pub satellite_opacity: f32,
    /// Optional Google Maps API key for the official Map Tiles API.
    ///
    /// Device-local browser credential: it is stored with the rest of the
    /// device settings, never in a Design, export, diagnostic bundle, error
    /// text or log. Without a key the Satellite row uses Google's keyless tiles.
    #[serde(default)]
    pub google_maps_api_key: Option<String>,
    pub contour_visible: bool,
    pub contour_opacity: f32,
    pub contour_interval: u32,
    pub hillshade_visible: bool,
    pub hillshade_opacity: f32,
    #[serde(default = "default_plant_spacing_interval_m")]
    pub plant_spacing_interval_m: f64,
    /// The camera view last shown on a Design; a new Design opens here.
    pub last_view: Option<LastView>,
}

/// A geographic camera view: WGS84 centre and MapLibre zoom.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct LastView {
    pub lon: f64,
    pub lat: f64,
    pub zoom: f64,
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
            basemap_style: BasemapStyle::Liberty,
            basemap_visible: true,
            basemap_opacity: 1.0,
            satellite_visible: false,
            satellite_opacity: 1.0,
            google_maps_api_key: None,
            contour_visible: false,
            contour_opacity: 1.0,
            contour_interval: 0,
            hillshade_visible: false,
            hillshade_opacity: 0.55,
            plant_spacing_interval_m: default_plant_spacing_interval_m(),
            last_view: None,
        }
    }
}

fn default_plant_spacing_interval_m() -> f64 {
    0.5
}

settings_enum! {
    /// OpenFreeMap vector styles; Liberty is the default.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
    #[serde(rename_all = "lowercase")]
    pub enum BasemapStyle {
        #[default]
        Liberty,
        Positron,
        Bright,
        Dark,
    }
}

settings_enum! {
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
}

settings_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
    #[serde(rename_all = "lowercase")]
    pub enum Theme {
        Light,
        Dark,
    }
}

#[cfg(test)]
mod tests {
    use super::{BasemapStyle, LastView, Settings};

    #[test]
    fn last_view_defaults_to_none_and_round_trips() {
        assert_eq!(Settings::default().last_view, None);
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "last_view": { "lon": 2.3522, "lat": 48.8566, "zoom": 17.5 }
        }))
        .expect("last view should load");
        assert_eq!(
            settings.last_view,
            Some(LastView {
                lon: 2.3522,
                lat: 48.8566,
                zoom: 17.5
            })
        );
        let value = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(
            value["last_view"],
            serde_json::json!({ "lon": 2.3522, "lat": 48.8566, "zoom": 17.5 })
        );
    }

    #[test]
    fn every_declared_basemap_style_deserializes_through_settings() {
        for style in BasemapStyle::ALL {
            let settings: Settings = serde_json::from_value(serde_json::json!({
                "basemap_style": style,
            }))
            .expect("declared basemap style should remain loadable");

            assert_eq!(settings.basemap_style, *style);
        }
    }

    #[test]
    fn map_layer_defaults_show_liberty_and_hide_satellite() {
        let settings = Settings::default();
        assert_eq!(settings.basemap_style, BasemapStyle::Liberty);
        assert!(settings.basemap_visible);
        assert!(!settings.satellite_visible);
    }

    /// Settings are read strictly: an invalid value refuses the whole record,
    /// and the Desktop settings service replaces a refused record with
    /// defaults. No field quietly rewrites a value it does not understand.
    #[test]
    fn invalid_setting_values_are_refused() {
        for invalid in [
            serde_json::json!({ "basemap_style": "street" }),
            serde_json::json!({ "theme": "sepia" }),
            serde_json::json!({ "locale": "xx" }),
            serde_json::json!({ "auto_save_interval_s": "soon" }),
        ] {
            assert!(
                serde_json::from_value::<Settings>(invalid.clone()).is_err(),
                "{invalid} should be refused"
            );
        }
    }

    #[test]
    fn retired_satellite_provider_key_loads_and_is_not_emitted() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "satellite_provider": "eox",
            "satellite_visible": true,
            "satellite_opacity": 0.4
        }))
        .expect("settings with the retired satellite provider key should load");

        assert!(settings.satellite_visible);
        assert_eq!(settings.satellite_opacity, 0.4);
        let serialized = serde_json::to_value(settings).expect("settings should serialize");
        assert!(serialized.get("satellite_provider").is_none());
    }
}
