use common_types::settings::{Locale, Settings};

use crate::db::{self, UserDb};

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

/// Settings key that keeps the last settings record this build refused.
const SET_ASIDE_SETTINGS_KEY: &str = "settings.set-aside";

/// Read Desktop settings.
///
/// One rule covers every invalid value: the stored record is read strictly,
/// and a record that does not parse (malformed JSON, an unknown theme, locale
/// or basemap style, a wrong type) is set aside under
/// [`SET_ASIDE_SETTINGS_KEY`] and replaced by defaults. Unknown keys are not
/// invalid; they are ignored and never re-emitted.
fn get_settings_with_locale(
    user_db: &UserDb,
    detected_os_locale: Option<&str>,
) -> Result<Settings, String> {
    let conn = user_db.acquire();
    let json = db::user_db::get_setting(&conn, "settings")
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    let refused = match json {
        Some(serialized) => match deserialize_settings(&serialized) {
            Ok(settings) => return Ok(settings),
            Err(error) => Some((serialized, error)),
        },
        None => None,
    };

    let mut settings = Settings::default();
    if let Some(locale) = detect_initial_locale(detected_os_locale) {
        settings.locale = locale;
    }
    let json = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    let transaction = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to save initial settings: {e}"))?;
    if let Some((serialized, error)) = &refused {
        db::user_db::set_setting(&transaction, SET_ASIDE_SETTINGS_KEY, serialized)
            .map_err(|e| format!("Failed to set aside invalid settings: {e}"))?;
        // The record may hold a credential, so only the parse position is logged.
        tracing::warn!(
            "Set aside unreadable settings (line {}, column {}); using defaults",
            error.line(),
            error.column()
        );
    }
    db::user_db::set_setting(&transaction, "settings", &json)
        .map_err(|e| format!("Failed to save initial settings: {e}"))?;
    transaction
        .commit()
        .map_err(|e| format!("Failed to save initial settings: {e}"))?;
    Ok(settings)
}

fn deserialize_settings(serialized: &str) -> Result<Settings, serde_json::Error> {
    serde_json::from_str(serialized)
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
    fn missing_fields_take_their_defaults() {
        let settings = super::deserialize_settings(
            r#"{"locale":"en","theme":"light","basemap_visible":true}"#,
        )
        .unwrap();

        assert_eq!(settings.basemap_style, BasemapStyle::Liberty);
    }

    fn store_raw_settings(user_db: &UserDb, raw: &str) {
        let conn = user_db.acquire();
        crate::db::user_db::set_setting(&conn, "settings", raw).unwrap();
    }

    fn stored_setting(user_db: &UserDb, key: &str) -> Option<String> {
        let conn = user_db.acquire();
        crate::db::user_db::get_setting(&conn, key).unwrap()
    }

    #[test]
    fn an_invalid_settings_record_is_set_aside_and_replaced_by_defaults() {
        for raw in [
            r#"{"locale":"en","theme":"sepia","google_maps_api_key":"SECRET-KEY"}"#,
            r#"{"locale":"xx","google_maps_api_key":"SECRET-KEY"}"#,
            r#"{"basemap_style":"ocean","google_maps_api_key":"SECRET-KEY"}"#,
            r#"{"google_maps_api_key":"SECRET-KEY""#,
        ] {
            let user_db = test_user_db();
            store_raw_settings(&user_db, raw);

            let (settings, logs) = crate::services::design_files::capture_logs(|| {
                get_settings_with_locale(&user_db, Some("fr_FR"))
            });
            let settings = settings.expect("invalid settings must not fail forever");

            assert_eq!(settings.theme, Theme::Light, "{raw}");
            assert_eq!(settings.locale, Locale::Fr, "{raw}");
            assert_eq!(settings.google_maps_api_key, None, "{raw}");
            assert_eq!(
                stored_setting(&user_db, super::SET_ASIDE_SETTINGS_KEY).as_deref(),
                Some(raw)
            );
            assert!(logs.contains("Set aside unreadable settings"), "{logs}");
            assert!(!logs.contains("SECRET-KEY"), "{logs}");

            let reread = get_settings_with_locale(&user_db, Some("en_US")).unwrap();
            assert_eq!(reread.locale, Locale::Fr, "defaults were persisted");
        }
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
            basemap_style: BasemapStyle::Dark,
            side_panel_width: Some(444),
            saved_stamps_frame_height: Some(260),
            ..Default::default()
        };

        set_settings(&user_db, settings.clone()).unwrap();

        let stored = get_settings_with_locale(&user_db, Some("en_US")).unwrap();
        assert_eq!(stored.locale, Locale::De);
        assert_eq!(stored.theme, Theme::Dark);
        assert_eq!(stored.basemap_style, BasemapStyle::Dark);
        assert_eq!(stored.side_panel_width, Some(444));
        assert_eq!(stored.saved_stamps_frame_height, Some(260));
    }
}
