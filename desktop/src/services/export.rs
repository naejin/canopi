use crate::platform::{CanvasSnapshot, Platform};

pub fn save_canvas_pdf(data: Vec<u8>, path: String) -> Result<(), String> {
    // Bound the admitted binary payload independently of the frontend renderer.
    if data.len() > 64 * 1024 * 1024 || !data.starts_with(b"%PDF-") || !data.ends_with(b"%%EOF\n") {
        return Err("Invalid Canvas PDF output".to_string());
    }
    let target = std::path::Path::new(&path);
    if !target
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Canvas PDF destination must have a .pdf extension".to_string());
    }
    crate::design::write_derived_file(target, &data)
        .map_err(|error| format!("Could not save Canvas PDF: {error}"))
}

pub fn export_file(data: String, path: String) -> Result<String, String> {
    write_bytes_to_path(path, data.as_bytes(), "text")
}

/// Upper bound for an imported GeoJSON file; the read stops one byte past it.
const MAX_GEOJSON_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Read a user-chosen GeoJSON file as UTF-8 text. Decoding and validation
/// happen in the shared frontend codec; a leading UTF-8 BOM is dropped so both
/// editions hand it the same text.
pub fn read_geojson_file(path: String) -> Result<String, String> {
    use std::io::Read;

    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open GeoJSON file {path}: {e}"))?;
    if !file
        .metadata()
        .map_err(|e| format!("Failed to inspect GeoJSON file {path}: {e}"))?
        .is_file()
    {
        return Err(format!("GeoJSON source {path} is not a file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_GEOJSON_IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read GeoJSON file {path}: {e}"))?;
    if bytes.len() as u64 > MAX_GEOJSON_IMPORT_BYTES {
        return Err(format!(
            "GeoJSON file {path} exceeds the {} MiB import limit",
            MAX_GEOJSON_IMPORT_BYTES / (1024 * 1024)
        ));
    }
    let text =
        String::from_utf8(bytes).map_err(|_| format!("GeoJSON file {path} is not UTF-8 text"))?;
    Ok(text
        .strip_prefix('\u{feff}')
        .map(str::to_owned)
        .unwrap_or(text))
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
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Failed to write {kind} file to {path}: {e}"))?;
    tracing::info!("Exported {kind} file to {path}");
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{MAX_GEOJSON_IMPORT_BYTES, export_file, export_native_png, read_geojson_file};
    use crate::platform::{CanvasSnapshot, Platform, PlatformError};
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    #[derive(Debug, Clone, PartialEq)]
    struct PngCall {
        dpi: u32,
        snapshot_width: u32,
        snapshot_height: u32,
        snapshot_png_data: Vec<u8>,
    }

    struct RecordingPlatform {
        png_result: Vec<u8>,
        png_calls: Mutex<Vec<PngCall>>,
    }

    impl RecordingPlatform {
        fn new() -> Self {
            Self {
                png_result: b"png-output".to_vec(),
                png_calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl Platform for RecordingPlatform {
        fn export_png(
            &self,
            snapshot: &CanvasSnapshot,
            dpi: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            self.png_calls.lock().unwrap().push(PngCall {
                dpi,
                snapshot_width: snapshot.width,
                snapshot_height: snapshot.height,
                snapshot_png_data: snapshot.png_data.clone(),
            });
            Ok(self.png_result.clone())
        }
    }

    struct TempTestDir {
        root: PathBuf,
    }

    impl TempTestDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root =
                std::env::temp_dir().join(format!("canopi-export-service-{label}-{sequence}"));
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
    fn canvas_pdf_publishes_exact_bytes_and_replaces_only_the_requested_pdf() {
        let temp = TempTestDir::new("shared-pdf");
        let target = temp.file("plan.pdf");
        let unrelated = temp.file("garden.canopi");
        std::fs::write(&target, b"previous PDF").unwrap();
        std::fs::write(&unrelated, b"editable design").unwrap();
        let bytes = b"%PDF-1.7\n\0binary content\n%%EOF\n".to_vec();
        super::save_canvas_pdf(bytes.clone(), target.display().to_string()).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), bytes);
        assert_eq!(std::fs::read(&unrelated).unwrap(), b"editable design");
        assert_eq!(std::fs::read_dir(&temp.root).unwrap().count(), 2);
    }

    #[test]
    fn canvas_pdf_invalid_payload_or_destination_preserves_existing_files() {
        let temp = TempTestDir::new("shared-pdf-invalid");
        let target = temp.file("plan.pdf");
        std::fs::write(&target, b"original").unwrap();
        assert!(
            super::save_canvas_pdf(b"not a PDF".to_vec(), target.display().to_string()).is_err()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        let design = temp.file("garden.canopi");
        std::fs::write(&design, b"design").unwrap();
        let bytes = b"%PDF-1.7\n%%EOF\n".to_vec();
        assert!(super::save_canvas_pdf(bytes.clone(), design.display().to_string()).is_err());
        assert_eq!(std::fs::read(&design).unwrap(), b"design");
        let directory = temp.file("directory.pdf");
        std::fs::create_dir(&directory).unwrap();
        assert!(super::save_canvas_pdf(bytes, directory.display().to_string()).is_err());
        assert!(directory.is_dir());
        assert_eq!(std::fs::read_dir(&temp.root).unwrap().count(), 3);
    }

    #[test]
    fn text_export_writes_to_disk() {
        let temp_dir = TempTestDir::new("text");
        let text_path = temp_dir.file("text.txt");

        export_file("hello".to_string(), text_path.display().to_string()).unwrap();

        assert_eq!(std::fs::read(&text_path).unwrap(), b"hello");
    }

    #[test]
    fn geojson_import_reads_utf8_text_without_a_byte_order_mark() {
        let temp_dir = TempTestDir::new("geojson-read");
        let plain = temp_dir.file("plain.geojson");
        let marked = temp_dir.file("marked.geojson");
        std::fs::write(&plain, "{\"type\":\"FeatureCollection\",\"features\":[]}").unwrap();
        std::fs::write(&marked, "\u{feff}{\"type\":\"Feature\"}").unwrap();

        assert_eq!(
            read_geojson_file(plain.display().to_string()).unwrap(),
            "{\"type\":\"FeatureCollection\",\"features\":[]}"
        );
        assert_eq!(
            read_geojson_file(marked.display().to_string()).unwrap(),
            "{\"type\":\"Feature\"}"
        );
    }

    #[test]
    fn geojson_import_refuses_non_text_directories_and_oversized_files() {
        let temp_dir = TempTestDir::new("geojson-refuse");
        let binary = temp_dir.file("binary.geojson");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_geojson_file(binary.display().to_string()).is_err());

        let directory = temp_dir.file("directory.geojson");
        std::fs::create_dir(&directory).unwrap();
        assert!(read_geojson_file(directory.display().to_string()).is_err());

        let oversized = temp_dir.file("oversized.geojson");
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_GEOJSON_IMPORT_BYTES + 1)
            .unwrap();
        assert!(
            read_geojson_file(oversized.display().to_string())
                .unwrap_err()
                .contains("import limit")
        );

        assert!(read_geojson_file(temp_dir.file("missing.geojson").display().to_string()).is_err());
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
    fn native_png_rejects_invalid_base64() {
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
    }
}
