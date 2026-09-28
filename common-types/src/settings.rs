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
    /// Settings › Map and imagery: which satellite imagery the map uses.
    /// `None` (a record saved before the choice existed) means the Google key
    /// when one is saved, otherwise the free imagery. Choosing the free
    /// imagery keeps the key; only Remove key forgets it.
    pub satellite_source: Option<SatelliteSource>,
    pub contour_visible: bool,
    pub contour_opacity: f32,
    pub contour_interval: u32,
    pub hillshade_visible: bool,
    pub hillshade_opacity: f32,
    /// Display on the map › Soften background: dims the Basemap or Satellite
    /// under every Design so plant symbols stand out. A device preference.
    pub soften_background: bool,
    #[serde(default = "default_plant_spacing_interval_m")]
    pub plant_spacing_interval_m: f64,
    /// The camera view last shown on a Design; a new Design opens here.
    pub last_view: Option<LastView>,
    /// Canvas tools used at least once on this device. The tool rail shows
    /// names and keys until every tool is in this list.
    pub used_canvas_tools: Vec<String>,
    /// View › Tool names: `None` follows first use, `Some` is the user's choice.
    pub tool_names_visible: Option<bool>,
    /// Settings › Keyboard: character-key shortcuts (tool keys such as V or
    /// P, N, Shift G, brackets). Off leaves only shortcuts with Ctrl, Alt or
    /// a named key (Delete, Esc, arrows, F keys).
    pub single_key_shortcuts: bool,
    /// Settings › Canvas: what a plain wheel or two-finger scroll does on the
    /// map. Pinch and Ctrl wheel always zoom; Shift wheel always pans.
    pub scroll_wheel: ScrollWheel,
    /// Settings › New Designs: a new Design turns Satellite on. Off keeps the
    /// background last used. Applied when a Design is created, never after.
    pub new_design_satellite: bool,
    /// Settings › New Designs: the symbol size a new Design starts with.
    pub new_design_symbol_scale: f32,
    /// Settings › New Designs: the plant labels a new Design starts with.
    pub new_design_labels: PlantLabels,
}

/// Settings › Files and data: a folder Canopi keeps in its app data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AppFolder {
    Drafts,
    DataLibrary,
}

/// Where this device keeps Canopi's folders. The paths are shown on this
/// screen only: they never enter a Design, a log or a Problem Report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppFolderLocations {
    pub drafts: String,
    pub data_library: String,
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
            side_panel_width: None,
            saved_stamps_frame_height: None,
            basemap_style: BasemapStyle::Liberty,
            basemap_visible: true,
            basemap_opacity: 1.0,
            satellite_visible: false,
            satellite_opacity: 1.0,
            google_maps_api_key: None,
            satellite_source: None,
            contour_visible: false,
            contour_opacity: 1.0,
            contour_interval: 0,
            hillshade_visible: false,
            hillshade_opacity: 0.55,
            soften_background: false,
            plant_spacing_interval_m: default_plant_spacing_interval_m(),
            last_view: None,
            used_canvas_tools: Vec::new(),
            tool_names_visible: None,
            single_key_shortcuts: true,
            scroll_wheel: ScrollWheel::Zoom,
            new_design_satellite: false,
            new_design_symbol_scale: 1.0,
            new_design_labels: PlantLabels::Names,
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
    /// Satellite imagery: Google's free tiles, or the official Map Tiles API
    /// with the device's own key.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
    #[serde(rename_all = "snake_case")]
    pub enum SatelliteSource {
        Free,
        GoogleKey,
    }
}

settings_enum! {
    /// Plant labels on the map: none, species codes or names.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
    #[serde(rename_all = "lowercase")]
    pub enum PlantLabels {
        None,
        Codes,
        #[default]
        Names,
    }
}

settings_enum! {
    /// What a plain wheel or two-finger scroll does on the map.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
    #[serde(rename_all = "lowercase")]
    pub enum ScrollWheel {
        #[default]
        Zoom,
        Pan,
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
    use super::{
        AppFolder, AppFolderLocations, BasemapStyle, LastView, PlantLabels, SatelliteSource,
        ScrollWheel, Settings,
    };

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
    fn soften_background_defaults_off_and_round_trips() {
        assert!(!Settings::default().soften_background);
        let settings: Settings =
            serde_json::from_value(serde_json::json!({ "soften_background": true }))
                .expect("soften background should load");
        assert!(settings.soften_background);
        let value = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(value["soften_background"], serde_json::json!(true));
    }

    #[test]
    fn tool_rail_learning_defaults_to_names_and_round_trips() {
        let defaults = Settings::default();
        assert!(defaults.used_canvas_tools.is_empty());
        assert_eq!(defaults.tool_names_visible, None);

        let settings: Settings = serde_json::from_value(serde_json::json!({
            "used_canvas_tools": ["select", "polygon"],
            "tool_names_visible": false
        }))
        .expect("tool rail settings should load");
        assert_eq!(settings.used_canvas_tools, vec!["select", "polygon"]);
        assert_eq!(settings.tool_names_visible, Some(false));
        let value = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(
            value["used_canvas_tools"],
            serde_json::json!(["select", "polygon"])
        );
        assert_eq!(value["tool_names_visible"], serde_json::json!(false));
    }

    #[test]
    fn keyboard_and_new_design_defaults_load_from_an_older_record_and_round_trip() {
        // A record saved before these fields existed still loads, with defaults.
        let settings: Settings = serde_json::from_value(serde_json::json!({ "theme": "dark" }))
            .expect("a record without the new fields should load");
        assert!(settings.single_key_shortcuts);
        assert!(!settings.new_design_satellite);
        assert_eq!(settings.new_design_symbol_scale, 1.0);
        assert_eq!(settings.new_design_labels, PlantLabels::Names);

        let settings: Settings = serde_json::from_value(serde_json::json!({
            "single_key_shortcuts": false,
            "new_design_satellite": true,
            "new_design_symbol_scale": 1.5,
            "new_design_labels": "codes"
        }))
        .expect("keyboard and New Design settings should load");
        let value = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(value["single_key_shortcuts"], serde_json::json!(false));
        assert_eq!(value["new_design_satellite"], serde_json::json!(true));
        assert_eq!(value["new_design_symbol_scale"], serde_json::json!(1.5));
        assert_eq!(value["new_design_labels"], serde_json::json!("codes"));
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({ "new_design_labels": "all" }))
                .is_err()
        );
    }

    #[test]
    fn scroll_wheel_defaults_to_zoom_and_round_trips() {
        assert_eq!(Settings::default().scroll_wheel, ScrollWheel::Zoom);
        let older: Settings = serde_json::from_value(serde_json::json!({ "theme": "dark" }))
            .expect("a record without a scroll wheel choice should load");
        assert_eq!(older.scroll_wheel, ScrollWheel::Zoom);

        let chosen: Settings = serde_json::from_value(serde_json::json!({ "scroll_wheel": "pan" }))
            .expect("an explicit scroll wheel choice should load");
        assert_eq!(chosen.scroll_wheel, ScrollWheel::Pan);
        let value = serde_json::to_value(&chosen).expect("settings should serialize");
        assert_eq!(value["scroll_wheel"], serde_json::json!("pan"));
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({ "scroll_wheel": "fling" }))
                .is_err()
        );
    }

    #[test]
    fn satellite_source_is_absent_in_an_older_record_and_round_trips() {
        let older: Settings =
            serde_json::from_value(serde_json::json!({ "google_maps_api_key": "k" }))
                .expect("a record without a satellite source should load");
        assert_eq!(older.satellite_source, None);
        assert_eq!(older.google_maps_api_key.as_deref(), Some("k"));

        let chosen: Settings = serde_json::from_value(serde_json::json!({
            "google_maps_api_key": "k",
            "satellite_source": "free"
        }))
        .expect("an explicit satellite source should load");
        assert_eq!(chosen.satellite_source, Some(SatelliteSource::Free));
        assert_eq!(chosen.google_maps_api_key.as_deref(), Some("k"));
        let value = serde_json::to_value(&chosen).expect("settings should serialize");
        assert_eq!(value["satellite_source"], serde_json::json!("free"));
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({ "satellite_source": "bing" }))
                .is_err()
        );
    }

    #[test]
    fn app_folders_use_their_wire_names() {
        assert_eq!(
            serde_json::to_value(AppFolder::DataLibrary).unwrap(),
            serde_json::json!("data_library")
        );
        assert_eq!(
            serde_json::from_value::<AppFolder>(serde_json::json!("drafts")).unwrap(),
            AppFolder::Drafts
        );
        let locations = AppFolderLocations {
            drafts: "/data/drafts".to_owned(),
            data_library: "/data/lidar".to_owned(),
        };
        let value = serde_json::to_value(&locations).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "drafts": "/data/drafts", "data_library": "/data/lidar" })
        );
        assert_eq!(
            serde_json::from_value::<AppFolderLocations>(value).unwrap(),
            locations.clone()
        );
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
            serde_json::json!({ "snap_to_grid": "sometimes" }),
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

    #[test]
    fn retired_auto_save_interval_key_loads_and_is_not_emitted() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "auto_save_interval_s": 60,
            "snap_to_grid": false
        }))
        .expect("settings with the retired autosave interval key should load");

        assert!(!settings.snap_to_grid);
        let serialized = serde_json::to_value(settings).expect("settings should serialize");
        assert!(serialized.get("auto_save_interval_s").is_none());
    }
}
