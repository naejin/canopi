use crate::db::{self, UserDb};
use common_types::settings::{Locale, Settings};

#[tauri::command]
pub fn get_settings(user_db: tauri::State<'_, UserDb>) -> Result<Settings, String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    let json = db::user_db::get_setting(&conn, "settings")
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    match json {
        Some(s) => {
            // Migrate stale values before deserializing — old DBs may have
            // "system" for theme which was removed from the Theme enum.
            let mut v: serde_json::Value =
                serde_json::from_str(&s).map_err(|e| format!("Failed to parse settings: {e}"))?;
            if v.get("theme").and_then(|t| t.as_str()) == Some("system") {
                v["theme"] = serde_json::json!("light");
            }
            serde_json::from_value(v).map_err(|e| format!("Failed to parse settings: {e}"))
        }
        None => {
            let mut settings = Settings::default();
            // Detect OS locale on first launch
            if let Some(os_locale) = sys_locale::get_locale() {
                let code = os_locale
                    .split(['_', '-'])
                    .next()
                    .unwrap_or("en")
                    .to_lowercase();
                let detected = match code.as_str() {
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
                    _ => None, // "en" or unsupported — keep default
                };
                if let Some(locale) = detected {
                    settings.locale = locale;
                }
            }
            // Persist so subsequent launches use this locale directly
            let json = serde_json::to_string(&settings)
                .map_err(|e| format!("Failed to serialize settings: {e}"))?;
            db::user_db::set_setting(&conn, "settings", &json)
                .map_err(|e| format!("Failed to save initial settings: {e}"))?;
            Ok(settings)
        }
    }
}

#[tauri::command]
pub fn set_settings(user_db: tauri::State<'_, UserDb>, settings: Settings) -> Result<(), String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    let json = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    db::user_db::set_setting(&conn, "settings", &json)
        .map_err(|e| format!("Failed to save settings: {e}"))
}
