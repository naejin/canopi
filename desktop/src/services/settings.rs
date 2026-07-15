use common_types::settings::{Locale, Settings};

use crate::db::{self, UserDb};

const LEGACY_BOTTOM_PANEL_DEFAULT_HEIGHT: u64 = 200;
const BOTTOM_PANEL_HEIGHT_KEYS: [&str; 3] = [
    "bottom_panel_timeline_height",
    "bottom_panel_budget_height",
    "bottom_panel_consortium_height",
];

pub fn get_settings(user_db: &UserDb) -> Result<Settings, String> {
    get_settings_with_locale(user_db, sys_locale::get_locale().as_deref())
}

pub fn set_settings(user_db: &UserDb, settings: Settings) -> Result<(), String> {
    let conn = user_db.acquire();
    let json = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    db::user_db::set_setting(&conn, "settings", &json)
        .map_err(|e| format!("Failed to save settings: {e}"))
}

fn get_settings_with_locale(
    user_db: &UserDb,
    detected_os_locale: Option<&str>,
) -> Result<Settings, String> {
    let conn = user_db.acquire();
    let json = db::user_db::get_setting(&conn, "settings")
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    match json {
        Some(serialized) => deserialize_settings(&serialized),
        None => {
            let mut settings = Settings::default();
            if let Some(locale) = detect_initial_locale(detected_os_locale) {
                settings.locale = locale;
            }
            let json = serde_json::to_string(&settings)
                .map_err(|e| format!("Failed to serialize settings: {e}"))?;
            db::user_db::set_setting(&conn, "settings", &json)
                .map_err(|e| format!("Failed to save initial settings: {e}"))?;
            Ok(settings)
        }
    }
}

fn deserialize_settings(serialized: &str) -> Result<Settings, String> {
    let mut value: serde_json::Value =
        serde_json::from_str(serialized).map_err(|e| format!("Failed to parse settings: {e}"))?;
    if value.get("theme").and_then(|theme| theme.as_str()) == Some("system") {
        value["theme"] = serde_json::json!("light");
    }
    migrate_legacy_bottom_panel_height(&mut value);
    serde_json::from_value(value).map_err(|e| format!("Failed to parse settings: {e}"))
}

fn migrate_legacy_bottom_panel_height(value: &mut serde_json::Value) {
    let Some(height) = value
        .get("bottom_panel_height")
        .and_then(|height| height.as_u64())
    else {
        return;
    };
    if height == LEGACY_BOTTOM_PANEL_DEFAULT_HEIGHT {
        return;
    }
    if height > u32::MAX as u64 {
        return;
    }
    let Some(settings) = value.as_object_mut() else {
        return;
    };
    for key in BOTTOM_PANEL_HEIGHT_KEYS {
        settings
            .entry(key.to_owned())
            .or_insert_with(|| serde_json::json!(height));
    }
}

fn detect_initial_locale(os_locale: Option<&str>) -> Option<Locale> {
    let code = os_locale?
        .split(['_', '-'])
        .next()
        .unwrap_or("en")
        .to_lowercase();

    match code.as_str() {
        "fr" => Some(Locale::Fr),
        "es" => Some(Locale::Es),
        "pt" => Some(Locale::Pt),
        "it" => Some(Locale::It),
        "zh" => Some(Locale::Zh),
        "de" => Some(Locale::De),
        "ja" => Some(Locale::Ja),
        "ko" => Some(Locale::Ko),
        "nl" => Some(Locale::Nl),
        "ru" => Some(Locale::Ru),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{get_settings_with_locale, set_settings};
    use crate::db::UserDb;
    use common_types::settings::{BasemapStyle, Locale, Settings, Theme};
    use rusqlite::Connection;

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        UserDb::initialize(conn).unwrap()
    }

    #[test]
    fn migrates_removed_system_theme_before_deserializing() {
        let user_db = test_user_db();
        {
            let conn = user_db.acquire();
            crate::db::user_db::set_setting(
                &conn,
                "settings",
                r#"{"locale":"en","theme":"system","snap_to_grid":true}"#,
            )
            .unwrap();
        }

        let settings = get_settings_with_locale(&user_db, Some("en_US")).unwrap();

        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.locale, Locale::En);
    }

    #[test]
    fn normalizes_missing_map_style_to_street() {
        let settings = super::deserialize_settings(
            r#"{"locale":"en","theme":"light","map_layer_visible":true}"#,
        )
        .unwrap();

        assert_eq!(settings.map_style, BasemapStyle::Street);
    }

    #[test]
    fn normalizes_invalid_map_style_to_street() {
        let settings =
            super::deserialize_settings(r#"{"locale":"en","theme":"light","map_style":"ocean"}"#)
                .unwrap();

        assert_eq!(settings.map_style, BasemapStyle::Street);
    }

    #[test]
    fn migrates_legacy_bottom_panel_height_to_per_tab_heights() {
        let settings = super::deserialize_settings(
            r#"{"locale":"en","theme":"light","bottom_panel_height":320}"#,
        )
        .unwrap();

        assert_eq!(settings.bottom_panel_timeline_height, Some(320));
        assert_eq!(settings.bottom_panel_budget_height, Some(320));
        assert_eq!(settings.bottom_panel_consortium_height, Some(320));
    }

    #[test]
    fn treats_legacy_default_bottom_panel_height_as_unset() {
        let settings = super::deserialize_settings(
            r#"{"locale":"en","theme":"light","bottom_panel_height":200}"#,
        )
        .unwrap();

        assert_eq!(settings.bottom_panel_timeline_height, None);
        assert_eq!(settings.bottom_panel_budget_height, None);
        assert_eq!(settings.bottom_panel_consortium_height, None);
    }

    #[test]
    fn initializes_and_persists_detected_locale_on_first_read() {
        let user_db = test_user_db();

        let settings = get_settings_with_locale(&user_db, Some("fr_FR")).unwrap();

        assert_eq!(settings.locale, Locale::Fr);

        let persisted = get_settings_with_locale(&user_db, Some("en_US")).unwrap();
        assert_eq!(persisted.locale, Locale::Fr);
    }

    #[test]
    fn saves_settings_round_trip() {
        let user_db = test_user_db();
        let settings = Settings {
            locale: Locale::De,
            theme: Theme::Dark,
            map_style: BasemapStyle::Satellite,
            side_panel_width: Some(444),
            saved_stamps_frame_height: Some(260),
            ..Default::default()
        };

        set_settings(&user_db, settings.clone()).unwrap();

        let stored = get_settings_with_locale(&user_db, Some("en_US")).unwrap();
        assert_eq!(stored.locale, Locale::De);
        assert_eq!(stored.theme, Theme::Dark);
        assert_eq!(stored.map_style, BasemapStyle::Satellite);
        assert_eq!(stored.side_panel_width, Some(444));
        assert_eq!(stored.saved_stamps_frame_height, Some(260));
        assert_eq!(stored.bottom_panel_timeline_height, None);
        assert_eq!(stored.bottom_panel_budget_height, None);
        assert_eq!(stored.bottom_panel_consortium_height, None);
    }
}
