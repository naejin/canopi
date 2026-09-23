//!
//! Standard COG assets: creation, digesting, admission and 0/1 quality reads.
//!
//! One controlled profile carries every persisted raster: single-band
//! Float32, 256×256 internal TIFF tiles, uncompressed, no overviews and no
//! internal mask. Retained source COGs, resolved generation chunks and
//! analysis quality chunks all use it, so one reader validates them all.
//! Assets are content-addressed and immutable; a reader never deletes one, and
//! a cancelled or failed job only removes files it staged itself.

use super::engine::{GdalEngine, GdalProgram};
use super::grid::RasterGrid;
use super::paths::LidarPaths;
use super::prepared_raster::{self, PreparedRaster, RasterWindow};
use sha2::{Digest, Sha256};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

/// Profile identity recorded in catalogue asset metadata.
pub(super) const COG_PROFILE: &str = "cog-f32-t256-raw-v1";
/// Bounded read size while digesting a file.
const HASH_CHUNK: usize = 64 * 1024;

/// One immutable standard COG on disk.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct CogAsset {
    pub sha256: String,
    pub path: PathBuf,
    pub bytes: u64,
    pub grid: RasterGrid,
    pub nodata: Option<f32>,
}

/// Digest a file with bounded I/O, cancellable between chunks.
pub(super) fn hash_file(path: &Path, cancel: &AtomicBool) -> Result<(String, u64), String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open raster asset {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; HASH_CHUNK];
    loop {
        super::import::check_cancel(cancel)?;
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read raster asset {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| "raster asset size overflows".to_string())?;
        hasher.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

/// Create one controlled COG from bounded in-memory samples and admit it into
/// the content-addressed asset store.
///
/// The scratch ENVI pair is removed before returning; only the validated,
/// digested COG remains. An identical digest already on disk is reused.
#[allow(clippy::too_many_arguments)]
pub(super) fn write_cog_asset(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    paths: &LidarPaths,
    scratch: &Path,
    stem: &str,
    grid: &RasterGrid,
    crs_wkt: &str,
    nodata: Option<f32>,
    values: &[f32],
) -> Result<CogAsset, String> {
    let expected = usize::try_from(
        u64::from(grid.width)
            .checked_mul(u64::from(grid.height))
            .ok_or_else(|| "asset dimensions overflow".to_string())?,
    )
    .map_err(|_| "asset is too large for this platform".to_string())?;
    if values.len() != expected {
        return Err(format!(
            "asset holds {} samples for a {}x{} grid",
            values.len(),
            grid.width,
            grid.height
        ));
    }
    let raw = scratch.join(format!("{stem}.raw"));
    let header = scratch.join(format!("{stem}.hdr"));
    {
        let mut output = std::io::BufWriter::new(
            std::fs::File::create(&raw)
                .map_err(|e| format!("Failed to create scratch raster: {e}"))?,
        );
        for value in values {
            output
                .write_all(&value.to_le_bytes())
                .map_err(|e| format!("Failed to write scratch raster: {e}"))?;
        }
        output
            .flush()
            .map_err(|e| format!("Failed to flush scratch raster: {e}"))?;
    }
    std::fs::write(
        &header,
        format!(
            "ENVI\nsamples = {}\nlines = {}\nbands = 1\ndata type = 4\nbyte order = 0\nheader offset = 0\n",
            grid.width, grid.height
        ),
    )
    .map_err(|e| format!("Failed to write scratch header: {e}"))?;

    let staged = scratch.join(format!("{stem}.tif"));
    let created = engine.run_uncapped_conversion(
        GdalProgram::Translate,
        &prepared_raster::controlled_cog_arguments(&raw, &staged, crs_wkt, grid, nodata),
        Some(cancel),
    );
    let _ = std::fs::remove_file(&raw);
    let _ = std::fs::remove_file(&header);
    created?;

    admit_staged_cog(paths, &staged, grid, nodata, cancel)
}

/// Create one controlled source COG inside the job directory that owns it.
///
/// Nothing is admitted here: the file stays job-local until publication, so a
/// cancelled or failed job owns exactly the bytes it created and no global
/// asset appears for an import that was never accepted.
#[allow(clippy::too_many_arguments)]
pub(super) fn write_job_source_cog(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    job_dir: &Path,
    stem: &str,
    input: &Path,
    grid: &RasterGrid,
    crs_wkt: &str,
    nodata: Option<f32>,
) -> Result<CogAsset, String> {
    let required = prepared_raster::required_free_bytes(grid.width, grid.height, 0)?;
    super::paths::require_free_space(job_dir, required, "the staged source COG")?;
    let staged = job_dir.join(format!("{stem}.tif"));
    let created = engine.run_uncapped_conversion(
        GdalProgram::Translate,
        &prepared_raster::controlled_cog_arguments(input, &staged, crs_wkt, grid, nodata),
        Some(cancel),
    );
    if let Err(error) = created {
        let _ = std::fs::remove_file(&staged);
        return Err(error);
    }
    let validated = (|| -> Result<CogAsset, String> {
        let reader = PreparedRaster::open_committed(&staged, grid, nodata)?;
        drop(reader);
        let (sha256, bytes) = hash_file(&staged, cancel)?;
        Ok(CogAsset {
            sha256,
            path: staged.clone(),
            bytes,
            grid: grid.clone(),
            nodata,
        })
    })();
    if validated.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    validated
}

/// Validate, digest and admit one staged COG into the content-addressed store.
///
/// Validation happens before the asset can be referenced: opening the staged
/// file through the production reader rejects a wrong layout or truncation.
/// An identical digest already on disk is reused, and a staged file that is not
/// admitted is removed, so a failed conversion leaves nothing behind.
pub(super) fn admit_staged_cog(
    paths: &LidarPaths,
    staged: &Path,
    grid: &RasterGrid,
    nodata: Option<f32>,
    cancel: &AtomicBool,
) -> Result<CogAsset, String> {
    let admitted = (|| -> Result<CogAsset, String> {
        let reader = PreparedRaster::open_committed(staged, grid, nodata)?;
        drop(reader);
        let (sha256, bytes) = hash_file(staged, cancel)?;
        let target = paths.asset_cog(&sha256);
        if target.exists() {
            let _ = std::fs::remove_file(staged);
        } else {
            std::fs::create_dir_all(
                target
                    .parent()
                    .ok_or_else(|| "asset path has no directory".to_string())?,
            )
            .map_err(|e| format!("Failed to create asset directory: {e}"))?;
            std::fs::rename(staged, &target)
                .map_err(|e| format!("Failed to publish raster asset: {e}"))?;
        }
        Ok(CogAsset {
            sha256,
            path: target,
            bytes,
            grid: grid.clone(),
            nodata,
        })
    })();
    if admitted.is_err() {
        let _ = std::fs::remove_file(staged);
    }
    admitted
}

/// Read a 0/1 quality asset through the bounded reader.
///
/// Quality assets carry no NoData tag and every sample must be exactly 0.0 or
/// 1.0; anything else is a corrupt asset rather than a silent partial mask.
// No production caller yet: the quality display consumer is deferred, and this
// read surface exists so the B1 round-trip is exercised end to end.
#[allow(dead_code)]
pub(super) fn read_quality_window(
    asset: &CogAsset,
    window: RasterWindow,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let mut reader = PreparedRaster::open_committed(&asset.path, &asset.grid, None)?;
    let samples = reader.read_window(window, cancel)?;
    let mut quality = Vec::with_capacity(samples.samples().len());
    for value in samples.samples() {
        let byte = match *value {
            0.0 => 0u8,
            1.0 => 1u8,
            other => {
                return Err(format!(
                    "quality asset {} holds {other}, expected exact 0 or 1",
                    asset.path.display()
                ));
            }
        };
        quality.push(byte);
    }
    Ok(quality)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "canopi-assets-{label}-{}-{}",
            std::process::id(),
            super::super::catalogue::new_id("t")
        ));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn library_paths(root: &Path) -> LidarPaths {
        LidarPaths::open(root).expect("library paths")
    }

    fn chunk_grid(x: u32, y: u32) -> RasterGrid {
        RasterGrid {
            width: 4,
            height: 3,
            geotransform: [
                f64::from(x) * 4.0,
                1.0,
                0.0,
                f64::from(y) * 3.0 + 3.0,
                0.0,
                -1.0,
            ],
        }
    }

    /// Authored resolved chunk samples: padding and holes are NaN, while zero,
    /// negative and a finite sentinel-like value stay valid.
    fn authored_values() -> Vec<f32> {
        vec![
            0.0,
            -12.5,
            -9999.0,
            f32::NAN,
            250.25,
            -0.0,
            1.5,
            2.5,
            3.5,
            4.5,
            5.5,
            f32::NAN,
        ]
    }

    #[test]
    fn hash_is_stable_and_counts_bytes() {
        let dir = scratch_dir("hash");
        let path = dir.join("bytes.bin");
        std::fs::write(&path, b"canopi-asset").unwrap();
        let (digest, bytes) = hash_file(&path, &AtomicBool::new(false)).unwrap();
        assert_eq!(bytes, 12);
        // Independently known SHA-256 of the same byte string.
        let mut hasher = Sha256::new();
        hasher.update(b"canopi-asset");
        assert_eq!(digest, format!("{:x}", hasher.finalize()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cog_asset_size_must_match_the_grid() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = scratch_dir("size");
        let paths = library_paths(&dir);
        let error = write_cog_asset(
            &engine,
            &cancel,
            &paths,
            &dir,
            "size",
            &chunk_grid(0, 0),
            "EPSG:3857",
            Some(f32::NAN),
            &[1.0, 2.0, 3.0],
        )
        .expect_err("a short sample buffer must be rejected");
        assert!(error.contains("3 samples for a 4x3 grid"), "{error}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn chunk_cog_round_trips_through_gdal_and_the_native_reader() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = scratch_dir("roundtrip");
        let paths = library_paths(&dir);
        let grid = chunk_grid(3, 5);
        let values = authored_values();

        // Resolved chunk: NaN NoData, exact Float32 values preserved.
        let asset = write_cog_asset(
            &engine,
            &cancel,
            &paths,
            &dir,
            "resolved",
            &grid,
            "EPSG:3857",
            Some(f32::NAN),
            &values,
        )
        .expect("resolved chunk is created");
        assert_eq!(asset.bytes, std::fs::metadata(&asset.path).unwrap().len());
        assert!(asset.path.exists());
        assert!(
            !dir.join("resolved.raw").exists() && !dir.join("resolved.hdr").exists(),
            "the ENVI scratch pair is removed"
        );

        let window = RasterWindow {
            x: 0,
            y: 0,
            width: grid.width,
            height: grid.height,
        };
        {
            // Reopened without any preparation: the committed file is the asset.
            let mut reader =
                PreparedRaster::open_committed(&asset.path, &grid, Some(f32::NAN)).unwrap();
            let read = reader.read_window(window, &cancel).unwrap();
            for (index, expected) in values.iter().enumerate() {
                let got = read.samples()[index];
                if expected.is_nan() {
                    assert!(got.is_nan(), "sample {index} stays NaN");
                    assert_eq!(read.valid()[index], 0, "NaN is invalid");
                } else {
                    assert_eq!(got.to_bits(), expected.to_bits(), "sample {index} bits");
                    assert_eq!(read.valid()[index], 1, "finite sample {index} is valid");
                }
            }
        }
        // Disposal closed the handle and kept the committed bytes.
        assert!(
            asset.path.exists(),
            "committed asset survives reader disposal"
        );
        assert_eq!(
            hash_file(&asset.path, &AtomicBool::new(false)).unwrap(),
            (asset.sha256.clone(), asset.bytes)
        );

        // GDAL reopens it as a correctly georeferenced standard raster.
        let info = engine
            .run(
                GdalProgram::Info,
                &["-json".to_string(), asset.path.display().to_string()],
                Some(&cancel),
            )
            .expect("GDAL reopens the chunk");
        let parsed: serde_json::Value = serde_json::from_str(&info.stdout).unwrap();
        assert_eq!(parsed["size"], serde_json::json!([4, 3]));
        assert_eq!(parsed["bands"][0]["type"], "Float32");
        assert_eq!(parsed["bands"][0]["block"], serde_json::json!([256, 256]));
        let transform = parsed["geoTransform"].as_array().unwrap();
        assert_eq!(transform[0].as_f64().unwrap(), grid.geotransform[0]);
        assert_eq!(transform[3].as_f64().unwrap(), grid.geotransform[3]);
        assert!(
            parsed["coordinateSystem"]["wkt"]
                .as_str()
                .unwrap()
                .contains("3857")
        );

        // Quality asset: exact 0/1 samples with no NoData tag.
        let quality_values: Vec<f32> =
            vec![1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0];
        let quality = write_cog_asset(
            &engine,
            &cancel,
            &paths,
            &dir,
            "quality",
            &grid,
            "EPSG:3857",
            None,
            &quality_values,
        )
        .expect("quality chunk is created");
        let bytes = read_quality_window(&quality, window, &cancel).expect("quality reads");
        assert_eq!(bytes, vec![1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1]);

        // A truncated asset is rejected rather than decoded partially.
        let truncated = dir.join("truncated.tif");
        let mut bytes = std::fs::read(&asset.path).unwrap();
        bytes.truncate(bytes.len() / 2);
        std::fs::write(&truncated, &bytes).unwrap();
        assert!(PreparedRaster::open_committed(&truncated, &grid, Some(f32::NAN)).is_err());

        // Re-creating identical content reuses the same asset file.
        let again = write_cog_asset(
            &engine,
            &cancel,
            &paths,
            &dir,
            "resolved-again",
            &grid,
            "EPSG:3857",
            Some(f32::NAN),
            &values,
        )
        .expect("re-created chunk");
        assert_eq!(again.sha256, asset.sha256);
        assert_eq!(again.path, asset.path);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn quality_asset_rejects_non_binary_samples() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = scratch_dir("quality-corrupt");
        let paths = library_paths(&dir);
        let grid = chunk_grid(0, 0);
        let mut values = vec![1.0f32; 12];
        values[5] = 0.5;
        let asset = write_cog_asset(
            &engine,
            &cancel,
            &paths,
            &dir,
            "quality",
            &grid,
            "EPSG:3857",
            None,
            &values,
        )
        .expect("asset is created");
        let error = read_quality_window(
            &asset,
            RasterWindow {
                x: 0,
                y: 0,
                width: grid.width,
                height: grid.height,
            },
            &cancel,
        )
        .expect_err("a non-binary quality sample must fail");
        assert!(error.contains("expected exact 0 or 1"), "{error}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
