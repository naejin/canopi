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

/// Extensions of the text exports that reach `export_file`: the budget CSV and
/// GeoJSON (`.geojson`, or `.json` when the user picks it in the dialog).
const TEXT_EXPORT_EXTENSIONS: &[&str] = &["csv", "geojson", "json"];
/// Upper bound for one text export, matching the Canvas PDF and GeoJSON import caps.
const MAX_TEXT_EXPORT_BYTES: usize = 64 * 1024 * 1024;

/// Atomically write a text export chosen through the save dialog. Only the
/// exported formats' extensions are accepted, so the boundary cannot replace a
/// design, a library file or any other document.
pub fn export_file(data: String, path: String) -> Result<String, String> {
    if data.len() > MAX_TEXT_EXPORT_BYTES {
        return Err(format!(
            "Export exceeds the {} MiB limit",
            MAX_TEXT_EXPORT_BYTES / (1024 * 1024)
        ));
    }
    let target = std::path::Path::new(&path);
    if !target.extension().is_some_and(|extension| {
        TEXT_EXPORT_EXTENSIONS
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    }) {
        return Err("Export destination must have a .csv, .geojson or .json extension".to_string());
    }
    crate::design::write_derived_file(target, data.as_bytes())
        .map_err(|error| format!("Could not write export: {error}"))?;
    Ok(path)
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

#[cfg(test)]
mod tests {
    use super::{MAX_GEOJSON_IMPORT_BYTES, MAX_TEXT_EXPORT_BYTES, export_file, read_geojson_file};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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
    fn text_export_replaces_only_the_requested_export_file() {
        let temp_dir = TempTestDir::new("text");
        let csv = temp_dir.file("budget.csv");
        let geojson = temp_dir.file("plan.GeoJSON");
        let json = temp_dir.file("plan.json");
        std::fs::write(&csv, b"previous").unwrap();

        for path in [&csv, &geojson, &json] {
            let written = export_file("hello".to_string(), path.display().to_string()).unwrap();
            assert_eq!(written, path.display().to_string());
            assert_eq!(std::fs::read(path).unwrap(), b"hello");
        }
        // No temporary sidecar is left beside the published exports.
        assert_eq!(std::fs::read_dir(&temp_dir.root).unwrap().count(), 3);
    }

    #[test]
    fn text_export_refuses_other_destinations_and_oversized_payloads() {
        let temp_dir = TempTestDir::new("text-refuse");
        let design = temp_dir.file("garden.canopi");
        std::fs::write(&design, b"design").unwrap();
        for name in ["garden.canopi", "notes.txt", "no-extension", "user.db"] {
            let path = temp_dir.file(name);
            assert!(
                export_file("x".to_string(), path.display().to_string())
                    .unwrap_err()
                    .contains("extension"),
                "{name}"
            );
        }
        assert_eq!(std::fs::read(&design).unwrap(), b"design");

        let directory = temp_dir.file("directory.csv");
        std::fs::create_dir(&directory).unwrap();
        assert!(export_file("x".to_string(), directory.display().to_string()).is_err());
        assert!(directory.is_dir());

        let oversized = temp_dir.file("oversized.csv");
        let error = export_file(
            "x".repeat(MAX_TEXT_EXPORT_BYTES + 1),
            oversized.display().to_string(),
        )
        .unwrap_err();
        assert!(error.contains("limit"), "{error}");
        assert!(!oversized.exists());
        assert_eq!(std::fs::read_dir(&temp_dir.root).unwrap().count(), 2);
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
}
