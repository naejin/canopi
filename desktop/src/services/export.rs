use crate::platform::{CanvasSnapshot, Platform, PrintLayout};

pub fn export_file(data: String, path: String) -> Result<String, String> {
    write_bytes_to_path(path, data.as_bytes(), "text")
}

pub fn export_binary(data: Vec<u8>, path: String) -> Result<String, String> {
    write_bytes_to_path(path, &data, "binary")
}

pub fn read_file_bytes(path: String) -> Result<(Vec<u8>, String), String> {
    let file_path = std::path::Path::new(&path);
    let data = std::fs::read(file_path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let filename = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string();
    tracing::info!("Read file '{}' ({} bytes)", filename, data.len());
    Ok((data, filename))
}

pub fn export_native_png(
    platform: &dyn Platform,
    snapshot_base64: String,
    width: u32,
    height: u32,
    dpi: u32,
    path: String,
) -> Result<String, String> {
    let snapshot = decode_canvas_snapshot(snapshot_base64, width, height)?;
    let rendered = platform
        .export_png(&snapshot, dpi)
        .map_err(|e| format!("Failed to export PNG at {dpi} DPI: {e}"))?;

    let written_path = write_bytes_to_path(path, &rendered, "native PNG")?;
    tracing::info!(
        "Exported native PNG ({dpi} DPI, {} bytes) to {}",
        rendered.len(),
        written_path
    );
    Ok(written_path)
}

#[allow(clippy::too_many_arguments, reason = "Service keeps the same flat export shape as IPC")]
pub fn export_native_pdf(
    platform: &dyn Platform,
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
    let snapshot = decode_canvas_snapshot(snapshot_base64, width, height)?;
    let layout = PrintLayout {
        page_width_mm,
        page_height_mm,
        margin_mm,
        title,
        scale_text,
        include_legend,
        include_plant_schedule,
    };
    let rendered = platform
        .export_pdf(&snapshot, &layout)
        .map_err(|e| format!("Failed to export PDF: {e}"))?;

    let written_path = write_bytes_to_path(path, &rendered, "native PDF")?;
    tracing::info!(
        "Exported native PDF ({} bytes) to {}",
        rendered.len(),
        written_path
    );
    Ok(written_path)
}

fn decode_canvas_snapshot(
    snapshot_base64: String,
    width: u32,
    height: u32,
) -> Result<CanvasSnapshot, String> {
    use base64::Engine;

    let png_data = base64::engine::general_purpose::STANDARD
        .decode(&snapshot_base64)
        .map_err(|e| format!("Failed to decode base64 snapshot: {e}"))?;

    Ok(CanvasSnapshot {
        width,
        height,
        png_data,
    })
}

fn write_bytes_to_path(path: String, bytes: &[u8], kind: &str) -> Result<String, String> {
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write {kind} file to {path}: {e}"))?;
    tracing::info!("Exported {kind} file to {path}");
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{
        export_binary, export_file, export_native_pdf, export_native_png, read_file_bytes,
    };
    use crate::platform::{CanvasSnapshot, FileWatchHandle, Platform, PlatformError, PrintLayout};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    #[derive(Debug, Clone, PartialEq)]
    struct PngCall {
        dpi: u32,
        snapshot_width: u32,
        snapshot_height: u32,
        snapshot_png_data: Vec<u8>,
    }

    #[derive(Debug, Clone, PartialEq)]
    struct PdfCall {
        snapshot_width: u32,
        snapshot_height: u32,
        snapshot_png_data: Vec<u8>,
        page_width_mm: f32,
        page_height_mm: f32,
        margin_mm: f32,
        title: String,
        scale_text: String,
        include_legend: bool,
        include_plant_schedule: bool,
    }

    struct RecordingPlatform {
        png_result: Vec<u8>,
        pdf_result: Vec<u8>,
        png_calls: Mutex<Vec<PngCall>>,
        pdf_calls: Mutex<Vec<PdfCall>>,
    }

    impl RecordingPlatform {
        fn new() -> Self {
            Self {
                png_result: b"png-output".to_vec(),
                pdf_result: b"pdf-output".to_vec(),
                png_calls: Mutex::new(Vec::new()),
                pdf_calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl Platform for RecordingPlatform {
        fn export_png(&self, snapshot: &CanvasSnapshot, dpi: u32) -> Result<Vec<u8>, PlatformError> {
            self.png_calls.lock().unwrap().push(PngCall {
                dpi,
                snapshot_width: snapshot.width,
                snapshot_height: snapshot.height,
                snapshot_png_data: snapshot.png_data.clone(),
            });
            Ok(self.png_result.clone())
        }

        fn export_pdf(
            &self,
            snapshot: &CanvasSnapshot,
            layout: &PrintLayout,
        ) -> Result<Vec<u8>, PlatformError> {
            self.pdf_calls.lock().unwrap().push(PdfCall {
                snapshot_width: snapshot.width,
                snapshot_height: snapshot.height,
                snapshot_png_data: snapshot.png_data.clone(),
                page_width_mm: layout.page_width_mm,
                page_height_mm: layout.page_height_mm,
                margin_mm: layout.margin_mm,
                title: layout.title.clone(),
                scale_text: layout.scale_text.clone(),
                include_legend: layout.include_legend,
                include_plant_schedule: layout.include_plant_schedule,
            });
            Ok(self.pdf_result.clone())
        }

        fn watch_file(&self, _path: &Path) -> Result<FileWatchHandle, PlatformError> {
            Err(PlatformError::NotImplemented)
        }

        fn generate_thumbnail(
            &self,
            _snapshot: &CanvasSnapshot,
            _size: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            Err(PlatformError::NotImplemented)
        }
    }

    struct TempTestDir {
        root: PathBuf,
    }

    impl TempTestDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!("canopi-export-service-{label}-{sequence}"));
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
    fn text_and_binary_exports_round_trip_from_disk() {
        let temp_dir = TempTestDir::new("round-trip");
        let text_path = temp_dir.file("text.txt");
        let binary_path = temp_dir.file("image.bin");

        export_file("hello".to_string(), text_path.display().to_string()).unwrap();
        export_binary(vec![1, 2, 3], binary_path.display().to_string()).unwrap();

        let (text_bytes, text_name) = read_file_bytes(text_path.display().to_string()).unwrap();
        let (binary_bytes, binary_name) = read_file_bytes(binary_path.display().to_string()).unwrap();

        assert_eq!(text_bytes, b"hello");
        assert_eq!(text_name, text_path.file_name().unwrap().to_string_lossy());
        assert_eq!(binary_bytes, vec![1, 2, 3]);
        assert_eq!(binary_name, binary_path.file_name().unwrap().to_string_lossy());
    }

    #[test]
    fn native_png_export_delegates_to_platform_and_writes_result() {
        use base64::Engine;

        let platform = RecordingPlatform::new();
        let temp_dir = TempTestDir::new("png");
        let output_path = temp_dir.file("snapshot.png");
        let snapshot_base64 = base64::engine::general_purpose::STANDARD.encode(b"raw-png");

        export_native_png(
            &platform,
            snapshot_base64,
            640,
            480,
            300,
            output_path.display().to_string(),
        )
        .unwrap();

        let calls = platform.png_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            PngCall {
                dpi: 300,
                snapshot_width: 640,
                snapshot_height: 480,
                snapshot_png_data: b"raw-png".to_vec(),
            }
        );
        assert_eq!(std::fs::read(&output_path).unwrap(), b"png-output");
    }

    #[test]
    fn native_pdf_export_delegates_to_platform_and_writes_result() {
        use base64::Engine;

        let platform = RecordingPlatform::new();
        let temp_dir = TempTestDir::new("pdf");
        let output_path = temp_dir.file("snapshot.pdf");
        let snapshot_base64 = base64::engine::general_purpose::STANDARD.encode(b"raw-png");

        export_native_pdf(
            &platform,
            snapshot_base64,
            1024,
            768,
            210.0,
            297.0,
            12.0,
            "Plan".to_string(),
            "1:100".to_string(),
            true,
            false,
            output_path.display().to_string(),
        )
        .unwrap();

        let calls = platform.pdf_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            PdfCall {
                snapshot_width: 1024,
                snapshot_height: 768,
                snapshot_png_data: b"raw-png".to_vec(),
                page_width_mm: 210.0,
                page_height_mm: 297.0,
                margin_mm: 12.0,
                title: "Plan".to_string(),
                scale_text: "1:100".to_string(),
                include_legend: true,
                include_plant_schedule: false,
            }
        );
        assert_eq!(std::fs::read(&output_path).unwrap(), b"pdf-output");
    }

    #[test]
    fn native_exports_reject_invalid_base64() {
        let platform = RecordingPlatform::new();
        let temp_dir = TempTestDir::new("invalid");

        let png_err = export_native_png(
            &platform,
            "***".to_string(),
            100,
            100,
            72,
            temp_dir.file("bad.png").display().to_string(),
        )
        .unwrap_err();
        assert!(png_err.contains("Failed to decode base64 snapshot"));

        let pdf_err = export_native_pdf(
            &platform,
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
