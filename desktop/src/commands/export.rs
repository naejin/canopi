use crate::platform;

/// Write `data` (UTF-8 text) to `path`. Used for SVG and CSV export.
#[tauri::command]
pub fn export_file(data: String, path: String) -> Result<String, String> {
    crate::services::export::export_file(data, path)
}

/// Write `data` (raw bytes) to `path`. Used for PNG export.
#[tauri::command]
pub fn export_binary(data: Vec<u8>, path: String) -> Result<String, String> {
    crate::services::export::export_binary(data, path)
}

/// Read a file and return `(bytes, filename)`. Used for background image import.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<(Vec<u8>, String), String> {
    crate::services::export::read_file_bytes(path)
}

// ---------------------------------------------------------------------------
// Native platform export commands (PNG at DPI, PDF with layout)
// ---------------------------------------------------------------------------

/// Export a canvas snapshot as PNG at the specified DPI.
///
/// `snapshot_base64`: base64-encoded PNG data from Konva `toDataURL`
/// `width`, `height`: logical canvas dimensions in pixels
/// `dpi`: target DPI (72 = 1x, 150, 300)
/// `path`: destination file path (chosen by frontend dialog)
#[tauri::command]
pub fn export_native_png(
    snapshot_base64: String,
    width: u32,
    height: u32,
    dpi: u32,
    path: String,
) -> Result<String, String> {
    let platform = platform::native_platform();
    crate::services::export::export_native_png(
        &platform,
        snapshot_base64,
        width,
        height,
        dpi,
        path,
    )
}

/// Export a canvas snapshot as PDF with the given layout.
///
/// `snapshot_base64`: base64-encoded PNG data from Konva `toDataURL`
/// `width`, `height`: logical canvas dimensions in pixels
/// Layout fields: page dimensions in mm, margins, title, etc.
/// `path`: destination file path (chosen by frontend dialog)
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC currently exposes PDF export as flat named arguments"
)]
#[tauri::command]
pub fn export_native_pdf(
    snapshot_base64: String,
    width: u32,
    height: u32,
    page_width_mm: f32,
    page_height_mm: f32,
    margin_mm: f32,
    title: String,
    scale_text: String,
    include_legend: bool,
    include_plant_schedule: bool,
    path: String,
) -> Result<String, String> {
    let platform = platform::native_platform();
    crate::services::export::export_native_pdf(
        &platform,
        snapshot_base64,
        width,
        height,
        page_width_mm,
        page_height_mm,
        margin_mm,
        title,
        scale_text,
        include_legend,
        include_plant_schedule,
        path,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        export_binary, export_file, export_native_pdf, export_native_png, read_file_bytes,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct TempTestDir {
        root: PathBuf,
    }

    impl TempTestDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!("canopi-export-command-{label}-{sequence}"));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn file(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn file_commands_round_trip_through_service_boundary() {
        let temp_dir = TempTestDir::new("files");
        let text_path = temp_dir.file("export.txt");
        let binary_path = temp_dir.file("export.bin");

        export_file("hello".to_string(), text_path.display().to_string()).unwrap();
        export_binary(vec![7, 8, 9], binary_path.display().to_string()).unwrap();

        let (text_bytes, text_name) = read_file_bytes(text_path.display().to_string()).unwrap();
        let (binary_bytes, binary_name) = read_file_bytes(binary_path.display().to_string()).unwrap();

        assert_eq!(text_bytes, b"hello");
        assert_eq!(text_name, "export.txt");
        assert_eq!(binary_bytes, vec![7, 8, 9]);
        assert_eq!(binary_name, "export.bin");
    }

    #[test]
    fn native_export_commands_reject_invalid_base64_before_rendering() {
        let temp_dir = TempTestDir::new("native-errors");

        let png_err = export_native_png(
            "***".to_string(),
            100,
            100,
            72,
            temp_dir.file("bad.png").display().to_string(),
        )
        .unwrap_err();
        assert!(png_err.contains("Failed to decode base64 snapshot"));

        let pdf_err = export_native_pdf(
            "***".to_string(),
            100,
            100,
            210.0,
            297.0,
            10.0,
            "Bad".to_string(),
            "1:1".to_string(),
            false,
            false,
            temp_dir.file("bad.pdf").display().to_string(),
        )
        .unwrap_err();
        assert!(pdf_err.contains("Failed to decode base64 snapshot"));
    }
}
