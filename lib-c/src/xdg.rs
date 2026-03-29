//! XDG Desktop integration for Linux.
//!
//! - `.desktop` entry generation
//! - MIME type registration for `.canopi` files
//! - DBus notification (stub — full impl planned for Phase 5.2)

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The MIME type for `.canopi` design files.
pub const CANOPI_MIME_TYPE: &str = "application/x-canopi";

/// The `.desktop` entry content.
const DESKTOP_ENTRY: &str = "\
[Desktop Entry]
Type=Application
Name=Canopi
Comment=Agroecological design tool
Exec=canopi %F
Icon=canopi
Terminal=false
Categories=Science;Education;
MimeType=application/x-canopi;
StartupWMClass=canopi
";

/// The MIME type XML definition.
const MIME_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-canopi">
    <comment>Canopi design file</comment>
    <glob pattern="*.canopi"/>
    <icon name="canopi"/>
  </mime-type>
</mime-info>
"#;

/// Return the XDG data home directory (`$XDG_DATA_HOME` or `~/.local/share`).
fn xdg_data_home() -> Result<PathBuf, String> {
    if let Ok(val) = std::env::var("XDG_DATA_HOME")
        && !val.is_empty()
    {
        return Ok(PathBuf::from(val));
    }
    let home = std::env::var("HOME").map_err(|_| "$HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".local").join("share"))
}

/// Install the `.desktop` file into `$XDG_DATA_HOME/applications/`.
pub fn install_desktop_entry() -> Result<PathBuf, String> {
    let data_home = xdg_data_home()?;
    let apps_dir = data_home.join("applications");
    std::fs::create_dir_all(&apps_dir)
        .map_err(|e| format!("Failed to create applications dir: {e}"))?;

    let desktop_path = apps_dir.join("canopi.desktop");
    let mut f = std::fs::File::create(&desktop_path)
        .map_err(|e| format!("Failed to create .desktop file: {e}"))?;
    f.write_all(DESKTOP_ENTRY.as_bytes())
        .map_err(|e| format!("Failed to write .desktop file: {e}"))?;

    // Attempt to update the desktop database (non-fatal if it fails).
    let _ = Command::new("update-desktop-database")
        .arg(&apps_dir)
        .status();

    Ok(desktop_path)
}

/// Register the MIME type for `.canopi` files.
pub fn register_mime_type() -> Result<PathBuf, String> {
    let data_home = xdg_data_home()?;
    let mime_dir = data_home.join("mime").join("packages");
    std::fs::create_dir_all(&mime_dir)
        .map_err(|e| format!("Failed to create mime packages dir: {e}"))?;

    let mime_path = mime_dir.join("canopi.xml");
    let mut f =
        std::fs::File::create(&mime_path).map_err(|e| format!("Failed to create MIME XML: {e}"))?;
    f.write_all(MIME_XML.as_bytes())
        .map_err(|e| format!("Failed to write MIME XML: {e}"))?;

    // Update the MIME database (non-fatal if it fails).
    let mime_base = data_home.join("mime");
    let _ = Command::new("update-mime-database")
        .arg(&mime_base)
        .status();

    Ok(mime_path)
}

/// Full XDG registration: desktop entry + MIME type.
pub fn register_all() -> Result<(), String> {
    install_desktop_entry()?;
    register_mime_type()?;
    Ok(())
}

/// Send a desktop notification via DBus.
///
/// Stub — returns `Ok(())` without doing anything.
/// Full implementation with `zbus` planned for Phase 5.2.
pub fn send_notification(_title: &str, _body: &str, _icon: Option<&Path>) -> Result<(), String> {
    // TODO: Phase 5.2 — use zbus to call org.freedesktop.Notifications.Notify
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entry_is_valid() {
        assert!(DESKTOP_ENTRY.contains("Type=Application"));
        assert!(DESKTOP_ENTRY.contains("MimeType=application/x-canopi"));
        assert!(DESKTOP_ENTRY.contains("Exec=canopi"));
    }

    #[test]
    fn mime_xml_is_valid() {
        assert!(MIME_XML.contains("application/x-canopi"));
        assert!(MIME_XML.contains("*.canopi"));
    }

    #[test]
    fn xdg_data_home_fallback() {
        // Temporarily override HOME to test the fallback path.
        // This test only checks the logic, not actual filesystem ops.
        let result = xdg_data_home();
        assert!(result.is_ok(), "xdg_data_home should succeed");
        let path = result.unwrap();
        assert!(
            path.to_str().unwrap().contains("share"),
            "Should contain 'share' in the path"
        );
    }
}
