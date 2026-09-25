//! Display derivatives for the upstream WASM raster renderer.
//!
//! Numeric COGs deliberately keep one uncompressed base level, which the
//! numeric readers require. The renderer instead needs tiled, compressed files
//! with overviews, so each displayed entity gets **display derivatives**: a
//! versioned profile of DEFLATE, 256-pixel blocks and averaged valid-data
//! overviews in the source CRS. They are regenerable display data only — never
//! a source member, a head or a result — and every read of physical values
//! keeps using the exact numeric generation.
//!
//! One derivative is produced per display source, in the entity's saved
//! priority order (top-first):
//!
//! - an ordered-collection source occurrence converts its own immutable COG,
//!   keyed by content digest, so reuse across items and Designs is free;
//! - a slope result's resolved chunks are read through their exact numeric
//!   reader in bounded windows, grouped into parts of at most
//!   `PART_CHUNKS`² occupied chunks. Empty space between distant chunks is never
//!   allocated.
//!
//! Files are written in a staging directory outside the WebView's asset scope
//! and renamed into `display-cog/` only when complete, so the renderer can never
//! read a partial derivative. Keys include the generation or content identity
//! and the profile, so a newer generation never reuses an older URL.

use super::grid::RasterGrid;
use super::{LidarLibrary, catalogue, collection, generation};
use common_types::lidar::{
    LidarDisplayAsset, LidarDisplayDescriptor, LidarDisplayRequest, LidarDisplayState,
    LidarSampleEntityKind,
};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::io::{Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Versioned display profile; part of every derivative key.
pub(super) const DISPLAY_PROFILE: &str = "display-cog-deflate256-v1";
/// Largest side of a composed part, in 1024-cell chunks.
const PART_CHUNKS: i64 = 8;
/// Invalid cells in a composed part: -2^127, exactly representable in Float32
/// and Float64 and written with a round-trip decimal, so every reader that
/// compares samples with the tag in either precision sees the same value. No
/// stored elevation, height or slope holds it.
const PART_NODATA: f32 = -1.701_411_8e38;

/// How one derivative is produced.
#[derive(Clone)]
enum PartSource {
    /// One immutable numeric COG converted with its own validity rule.
    Asset { path: PathBuf, nodata: Option<f32> },
    /// Bounded windows of an exact reader over occupied chunks of one group.
    Windows {
        reader: Arc<WindowReader>,
        /// Group's occupied chunk coordinates, row-major.
        chunks: Vec<(i64, i64)>,
    },
}

/// An exact numeric reader for composed parts.
struct WindowReader {
    reader: generation::GenerationReader,
    lattice: RasterGrid,
    crs_wkt: String,
}

#[derive(Clone)]
struct PartSpec {
    key: String,
    source: PartSource,
}

/// Every derivative one entity generation needs, top-first.
pub(super) struct DisplayPlan {
    kind: LidarSampleEntityKind,
    entity_id: String,
    generation_id: String,
    crs_wkt: String,
    parts: Vec<PartSpec>,
}

enum Planned {
    Plan(Arc<DisplayPlan>),
    Unavailable(Option<String>, String),
}

/// Library-owned preparation lane state.
#[derive(Default)]
pub(crate) struct DisplayPreparation {
    plans: HashMap<String, Arc<DisplayPlan>>,
    queue: VecDeque<Arc<DisplayPlan>>,
    pending: HashSet<String>,
    failures: HashMap<String, String>,
    running: bool,
}

fn plan_key(kind: LidarSampleEntityKind, entity_id: &str, generation_id: &str) -> String {
    let kind = match kind {
        LidarSampleEntityKind::Source => "source",
        LidarSampleEntityKind::Analysis => "analysis",
    };
    format!("{kind}/{entity_id}/{generation_id}")
}

fn nodata_tag(nodata: Option<f32>) -> String {
    match nodata {
        Some(value) => format!("{:08x}", value.to_bits()),
        None => "none".to_string(),
    }
}

/// Resolve the current generation of one entity and the derivatives it needs.
fn build_plan(
    library: &LidarLibrary,
    kind: LidarSampleEntityKind,
    entity_id: &str,
    cancel: &AtomicBool,
) -> Result<Planned, String> {
    match kind {
        LidarSampleEntityKind::Source => {
            let head = {
                let connection = library.catalogue()?;
                catalogue::head_generation(&connection, entity_id)?
            };
            let Some(head) = head else {
                return Ok(Planned::Unavailable(
                    None,
                    "this item has no published data yet".to_string(),
                ));
            };
            let manifest = super::import::read_generation_manifest(&head.manifest_json)?;
            let parts = collection::snapshot_members(library, &head.id, cancel)?
                .into_iter()
                .map(|member| {
                    let cog = &member.resolved.cog;
                    PartSpec {
                        key: format!(
                            "asset-{}-{}",
                            cog.sha256,
                            nodata_tag(member.resolved.nodata)
                        ),
                        source: PartSource::Asset {
                            path: cog.path.clone(),
                            nodata: member.resolved.nodata,
                        },
                    }
                })
                .collect();
            Ok(Planned::Plan(Arc::new(DisplayPlan {
                kind,
                entity_id: entity_id.to_string(),
                generation_id: head.id,
                crs_wkt: manifest.crs_wkt,
                parts,
            })))
        }
        LidarSampleEntityKind::Analysis => {
            let result = {
                let connection = library.catalogue()?;
                catalogue::head_analysis_generation(&connection, entity_id)?
            };
            let Some(result) = result else {
                return Ok(Planned::Unavailable(
                    None,
                    "this result has not been published".to_string(),
                ));
            };
            let manifest: super::analysis::ResultManifest =
                serde_json::from_str(&result.manifest_json)
                    .map_err(|e| format!("Invalid analysis manifest: {e}"))?;
            let coordinates = {
                let connection = library.catalogue()?;
                catalogue::published_chunk_coordinates(
                    &connection,
                    &result.id,
                    generation::RESULT_ROLE,
                )?
            };
            let reader = Arc::new(WindowReader {
                reader: generation::GenerationReader::Chunks(
                    generation::GenerationChunkReader::new(&result.id, generation::RESULT_ROLE),
                ),
                lattice: manifest.grid.clone(),
                crs_wkt: manifest.crs_wkt.clone(),
            });
            let parts = grouped_parts(&format!("gen-{}", result.id), &reader, coordinates);
            Ok(Planned::Plan(Arc::new(DisplayPlan {
                kind,
                entity_id: entity_id.to_string(),
                generation_id: result.id,
                crs_wkt: manifest.crs_wkt,
                parts,
            })))
        }
    }
}

/// Group occupied chunks into parts of at most `PART_CHUNKS`² chunks.
fn grouped_parts(
    prefix: &str,
    reader: &Arc<WindowReader>,
    coordinates: Vec<(i64, i64)>,
) -> Vec<PartSpec> {
    let mut groups: BTreeMap<(i64, i64), Vec<(i64, i64)>> = BTreeMap::new();
    for (x, y) in coordinates {
        groups
            .entry((y.div_euclid(PART_CHUNKS), x.div_euclid(PART_CHUNKS)))
            .or_default()
            .push((x, y));
    }
    groups
        .into_iter()
        .map(|((group_y, group_x), chunks)| PartSpec {
            key: format!("{prefix}-{group_x}_{group_y}"),
            source: PartSource::Windows {
                reader: Arc::clone(reader),
                chunks,
            },
        })
        .collect()
}

/// A prepared derivative as the registry records it.
#[derive(Clone)]
struct Prepared {
    /// File name inside `display-cog/`; empty for a part with no valid cell.
    file: String,
    bounds: [f64; 4],
}

fn registered(display: &rusqlite::Connection, key: &str) -> Result<Option<Prepared>, String> {
    use rusqlite::OptionalExtension as _;
    display
        .query_row(
            "SELECT file, west, south, east, north FROM display_cogs WHERE key = ?1",
            [key],
            |row| {
                Ok(Prepared {
                    file: row.get(0)?,
                    bounds: [row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?],
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read the display registry: {e}"))
}

fn record(
    display: &rusqlite::Connection,
    key: &str,
    prepared: &Prepared,
    bytes: u64,
) -> Result<(), String> {
    display
        .execute(
            "INSERT INTO display_cogs(key, file, bytes, west, south, east, north, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(key) DO UPDATE SET file = excluded.file, bytes = excluded.bytes,
                 west = excluded.west, south = excluded.south, east = excluded.east,
                 north = excluded.north, created_at = excluded.created_at",
            rusqlite::params![
                key,
                prepared.file,
                i64::try_from(bytes).unwrap_or(i64::MAX),
                prepared.bounds[0],
                prepared.bounds[1],
                prepared.bounds[2],
                prepared.bounds[3],
                catalogue::now_iso(),
            ],
        )
        .map_err(|e| format!("Failed to record a display derivative: {e}"))?;
    Ok(())
}

/// A registered derivative whose file is still on disk.
fn ready_part(library: &LidarLibrary, key: &str) -> Result<Option<Prepared>, String> {
    let prepared = {
        let display = library.display()?;
        registered(&display, key)?
    };
    Ok(prepared.filter(|prepared| {
        prepared.file.is_empty()
            || library
                .inner
                .paths
                .display_cog_dir()
                .join(&prepared.file)
                .is_file()
    }))
}

impl LidarLibrary {
    /// Describe the display derivatives of one entity's current generation,
    /// starting their preparation when any is missing.
    pub fn display_descriptor(
        &self,
        request: &LidarDisplayRequest,
    ) -> Result<LidarDisplayDescriptor, String> {
        let cancel = AtomicBool::new(false);
        let planned = build_plan(self, request.kind, &request.entity_id, &cancel)?;
        let empty = |generation_id: Option<String>, state, message: Option<String>| {
            LidarDisplayDescriptor {
                kind: request.kind,
                entity_id: request.entity_id.clone(),
                generation_id,
                profile: DISPLAY_PROFILE.to_string(),
                state,
                message,
                assets: Vec::new(),
                prepared_assets: 0,
                total_assets: 0,
            }
        };
        let plan = match planned {
            Planned::Unavailable(generation_id, message) => {
                return Ok(empty(
                    generation_id,
                    LidarDisplayState::Unavailable,
                    Some(message),
                ));
            }
            Planned::Plan(plan) => plan,
        };
        if let Some(expected) = request.expected_generation_id.as_deref()
            && expected != plan.generation_id
        {
            return Ok(empty(
                Some(plan.generation_id.clone()),
                LidarDisplayState::Stale,
                Some("the item changed since it was requested".to_string()),
            ));
        }
        let mut assets = Vec::with_capacity(plan.parts.len());
        let mut prepared = 0u32;
        for part in &plan.parts {
            if let Some(ready) = ready_part(self, &part.key)? {
                prepared += 1;
                if !ready.file.is_empty() {
                    assets.push(LidarDisplayAsset {
                        path: self
                            .inner
                            .paths
                            .display_cog_dir()
                            .join(&ready.file)
                            .display()
                            .to_string(),
                        bounds: ready.bounds,
                    });
                }
            }
        }
        let total = u32::try_from(plan.parts.len()).unwrap_or(u32::MAX);
        let mut descriptor = empty(
            Some(plan.generation_id.clone()),
            LidarDisplayState::Ready,
            None,
        );
        descriptor.prepared_assets = prepared;
        descriptor.total_assets = total;
        if prepared == total {
            descriptor.assets = assets;
            return Ok(descriptor);
        }
        let key = plan_key(plan.kind, &plan.entity_id, &plan.generation_id);
        let failure = {
            let mut state = self.display_preparation()?;
            if request.retry {
                state.failures.remove(&key);
            }
            state.failures.get(&key).cloned()
        };
        if let Some(message) = failure {
            descriptor.state = LidarDisplayState::Failed;
            descriptor.message = Some(message);
            return Ok(descriptor);
        }
        self.enqueue_display_preparation(plan)?;
        descriptor.state = LidarDisplayState::Preparing;
        Ok(descriptor)
    }

    pub(crate) fn display_preparation(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, DisplayPreparation>, String> {
        self.inner
            .display_preparation
            .lock()
            .map_err(|_| "LiDAR display preparation state poisoned".to_string())
    }

    fn enqueue_display_preparation(&self, plan: Arc<DisplayPlan>) -> Result<(), String> {
        let key = plan_key(plan.kind, &plan.entity_id, &plan.generation_id);
        let start = {
            let mut state = self.display_preparation()?;
            state.plans.insert(key.clone(), Arc::clone(&plan));
            if state.pending.insert(key) {
                state.queue.push_back(plan);
            }
            !std::mem::replace(&mut state.running, true)
        };
        if start {
            let library = self.clone();
            let executor = match self.executor() {
                Ok(executor) => executor,
                Err(error) => {
                    if let Ok(mut state) = self.display_preparation() {
                        state.running = false;
                    }
                    return Err(error);
                }
            };
            tauri::async_runtime::spawn(async move {
                loop {
                    let next = library.display_preparation().ok().and_then(|mut state| {
                        let next = state.queue.pop_front();
                        if next.is_none() {
                            state.running = false;
                        }
                        next
                    });
                    let Some(plan) = next else { break };
                    let key = plan_key(plan.kind, &plan.entity_id, &plan.generation_id);
                    let worker = library.clone();
                    let job = Arc::clone(&plan);
                    let outcome = executor
                        .run(
                            crate::native_operation::NativeOperationClass::Local,
                            "lidar display preparation",
                            move || {
                                let cancel = AtomicBool::new(false);
                                worker.prepare_display_plan(&job, &cancel)
                            },
                        )
                        .await;
                    if let Ok(mut state) = library.display_preparation() {
                        state.pending.remove(&key);
                        match outcome {
                            Ok(()) => {
                                state.failures.remove(&key);
                            }
                            Err(error) => {
                                tracing::warn!(key, error, "LiDAR display preparation failed");
                                state.failures.insert(key, error);
                            }
                        }
                    }
                }
            });
        }
        Ok(())
    }

    /// Prepare every missing derivative of one plan, in priority order.
    pub(super) fn prepare_display_plan(
        &self,
        plan: &DisplayPlan,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        for part in &plan.parts {
            if cancel.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            if ready_part(self, &part.key)?.is_some() {
                continue;
            }
            let (prepared, bytes) = self.prepare_part(part, &plan.crs_wkt, cancel)?;
            let display = self.display()?;
            record(&display, &part.key, &prepared, bytes)?;
        }
        Ok(())
    }

    fn prepare_part(
        &self,
        part: &PartSpec,
        crs_wkt: &str,
        cancel: &AtomicBool,
    ) -> Result<(Prepared, u64), String> {
        let staging = self.inner.paths.display_cog_staging_dir();
        std::fs::create_dir_all(&staging)
            .map_err(|e| format!("Failed to create display staging: {e}"))?;
        let file = format!("{}.tif", part.key);
        let staged = staging.join(&file);
        let _ = std::fs::remove_file(&staged);
        let engine = &self.inner.engine;
        match &part.source {
            PartSource::Asset { path, nodata } => {
                let bytes = std::fs::metadata(path)
                    .map_err(|e| format!("Display source {} is unavailable: {e}", path.display()))?
                    .len();
                // Compressed output plus overviews never exceeds the
                // uncompressed input by more than a third.
                super::paths::require_free_space(
                    &staging,
                    bytes.saturating_add(bytes / 3),
                    "Display preparation",
                )?;
                let mut args = display_arguments(*nodata);
                args.push(path.display().to_string());
                args.push(staged.display().to_string());
                let converted = engine.run_uncapped_conversion(
                    super::engine::GdalProgram::Translate,
                    &args,
                    Some(cancel),
                );
                if let Err(error) = converted {
                    let _ = std::fs::remove_file(&staged);
                    return Err(error);
                }
            }
            PartSource::Windows { reader, chunks } => {
                let written = self.write_part_windows(reader, chunks, &staged, crs_wkt, cancel);
                match written {
                    Ok(true) => {}
                    Ok(false) => {
                        // No valid cell: record the part as empty rather than
                        // publishing a transparent file.
                        return Ok((
                            Prepared {
                                file: String::new(),
                                bounds: [0.0; 4],
                            },
                            0,
                        ));
                    }
                    Err(error) => {
                        let _ = std::fs::remove_file(&staged);
                        return Err(error);
                    }
                }
            }
        }
        let bounds = match wgs84_extent(engine, &staged, cancel) {
            Ok(bounds) => bounds,
            Err(error) => {
                let _ = std::fs::remove_file(&staged);
                return Err(error);
            }
        };
        std::fs::File::open(&staged)
            .and_then(|file| file.sync_all())
            .map_err(|e| format!("Failed to sync a display derivative: {e}"))?;
        let bytes = std::fs::metadata(&staged)
            .map(|meta| meta.len())
            .unwrap_or(0);
        let published = self.inner.paths.display_cog_dir().join(&file);
        std::fs::rename(&staged, &published)
            .map_err(|e| format!("Failed to publish a display derivative: {e}"))?;
        Ok((Prepared { file, bounds }, bytes))
    }

    /// Compose one part from bounded exact windows. Returns whether any cell
    /// is valid.
    fn write_part_windows(
        &self,
        reader: &WindowReader,
        chunks: &[(i64, i64)],
        staged: &Path,
        crs_wkt: &str,
        cancel: &AtomicBool,
    ) -> Result<bool, String> {
        let side = generation::CHUNK_SIDE;
        let min_x = chunks.iter().map(|chunk| chunk.0).min().unwrap_or(0);
        let max_x = chunks.iter().map(|chunk| chunk.0).max().unwrap_or(0);
        let min_y = chunks.iter().map(|chunk| chunk.1).min().unwrap_or(0);
        let max_y = chunks.iter().map(|chunk| chunk.1).max().unwrap_or(0);
        let columns = (max_x - min_x + 1) as usize;
        let rows = (max_y - min_y + 1) as usize;
        let width = columns * side as usize;
        let height = rows * side as usize;
        let row_bytes = width * 4;
        super::paths::require_free_space(
            staged.parent().unwrap_or(staged),
            (row_bytes * height) as u64 * 2,
            "Display preparation",
        )?;
        let raw = staged.with_extension("raw");
        let header = staged.with_extension("hdr");
        let cleanup = || {
            let _ = std::fs::remove_file(&raw);
            let _ = std::fs::remove_file(&header);
        };
        let occupied: HashSet<(i64, i64)> = chunks.iter().copied().collect();
        let mut any_valid = false;
        let result = (|| -> Result<(), String> {
            let mut output = std::fs::File::create(&raw)
                .map_err(|e| format!("Failed to create a display part: {e}"))?;
            output
                .set_len((row_bytes * height) as u64)
                .map_err(|e| format!("Failed to size a display part: {e}"))?;
            let empty_row: Vec<u8> = PART_NODATA
                .to_le_bytes()
                .iter()
                .copied()
                .cycle()
                .take(side as usize * 4)
                .collect();
            let mut buffer = vec![0u8; side as usize * 4];
            for chunk_y in min_y..=max_y {
                for chunk_x in min_x..=max_x {
                    if cancel.load(Ordering::Relaxed) {
                        return Err("cancelled".to_string());
                    }
                    let column = (chunk_x - min_x) as usize;
                    let row0 = (chunk_y - min_y) as usize * side as usize;
                    let window = if occupied.contains(&(chunk_x, chunk_y)) {
                        Some(reader.reader.read_window(
                            self,
                            &reader.lattice,
                            generation::LatticeWindow {
                                x: chunk_x * side,
                                y: chunk_y * side,
                                width: side as u32,
                                height: side as u32,
                            },
                            cancel,
                        )?)
                    } else {
                        None
                    };
                    for line in 0..side as usize {
                        let offset = ((row0 + line) * width + column * side as usize) * 4;
                        output
                            .seek(SeekFrom::Start(offset as u64))
                            .map_err(|e| format!("Failed to write a display part: {e}"))?;
                        match &window {
                            None => output
                                .write_all(&empty_row)
                                .map_err(|e| format!("Failed to write a display part: {e}"))?,
                            Some(window) => {
                                let start = line * side as usize;
                                for (index, slot) in buffer.chunks_exact_mut(4).enumerate() {
                                    let valid = window.valid[start + index] != 0;
                                    let sample = window.samples[start + index];
                                    let value = if valid && sample.is_finite() {
                                        any_valid = true;
                                        sample
                                    } else {
                                        PART_NODATA
                                    };
                                    slot.copy_from_slice(&value.to_le_bytes());
                                }
                                output
                                    .write_all(&buffer)
                                    .map_err(|e| format!("Failed to write a display part: {e}"))?;
                            }
                        }
                    }
                }
            }
            output
                .flush()
                .map_err(|e| format!("Failed to flush a display part: {e}"))?;
            std::fs::write(
                &header,
                format!(
                    "ENVI\nsamples = {width}\nlines = {height}\nbands = 1\ndata type = 4\nbyte order = 0\nheader offset = 0\n"
                ),
            )
            .map_err(|e| format!("Failed to write a display part header: {e}"))?;
            Ok(())
        })();
        if let Err(error) = result {
            cleanup();
            return Err(error);
        }
        if !any_valid {
            cleanup();
            return Ok(false);
        }
        let gt = reader.lattice.geotransform;
        let origin_x = gt[0] + (min_x * side) as f64 * gt[1];
        let origin_y = gt[3] + (min_y * side) as f64 * gt[5];
        let crs = if reader.crs_wkt.is_empty() {
            crs_wkt
        } else {
            &reader.crs_wkt
        };
        let mut args = display_arguments(Some(PART_NODATA));
        args.extend([
            "-a_srs".to_string(),
            crs.to_string(),
            "-a_ullr".to_string(),
            format!("{origin_x}"),
            format!("{origin_y}"),
            format!("{}", origin_x + width as f64 * gt[1]),
            format!("{}", origin_y + height as f64 * gt[5]),
            raw.display().to_string(),
            staged.display().to_string(),
        ]);
        let converted = self.inner.engine.run_uncapped_conversion(
            super::engine::GdalProgram::Translate,
            &args,
            Some(cancel),
        );
        cleanup();
        converted.map(|_| true)
    }
}

impl LidarLibrary {
    /// Prepare the display derivative of every staged source before the
    /// import publishes, inside the import job: a new item is displayable the
    /// moment it appears. A failure or cancellation here publishes nothing.
    pub(super) fn prepare_staged_display(
        &self,
        staging: &super::import::StagedImport,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        for source in &staging.sources {
            let cog = &source.source_cog;
            let part = PartSpec {
                key: format!("asset-{}-{}", cog.sha256, nodata_tag(cog.nodata)),
                source: PartSource::Asset {
                    path: cog.resolve(&self.inner.paths, &source.job_id)?,
                    nodata: cog.nodata,
                },
            };
            if ready_part(self, &part.key)?.is_some() {
                continue;
            }
            let (prepared, bytes) = self.prepare_part(&part, &source.crs_wkt, cancel)?;
            let display = self.display()?;
            record(&display, &part.key, &prepared, bytes)?;
        }
        Ok(())
    }
}

/// `gdal_translate` options of the display profile, before the positionals.
fn display_arguments(nodata: Option<f32>) -> Vec<String> {
    let mut args: Vec<String> = [
        "-q",
        "-of",
        "COG",
        "-ot",
        "Float32",
        "-b",
        "1",
        "--config",
        "GDAL_PAM_ENABLED",
        "NO",
        "-co",
        "BLOCKSIZE=256",
        "-co",
        "COMPRESS=DEFLATE",
        "-co",
        "OVERVIEWS=IGNORE_EXISTING",
        "-co",
        "RESAMPLING=AVERAGE",
        "-co",
        "NUM_THREADS=2",
        "-co",
        "STATISTICS=NO",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    if let Some(nodata) = nodata {
        args.push("-a_nodata".to_string());
        // Shortest round-trip form of the exact value: a rounded decimal such
        // as f32::MIN's "-3.4028235e38" parses to a different f64 and makes the
        // renderer draw invalid cells.
        args.push(format!("{:?}", f64::from(nodata)));
    }
    args
}

/// WGS84 footprint of a written derivative, as GDAL reports it.
fn wgs84_extent(
    engine: &super::engine::GdalEngine,
    path: &Path,
    cancel: &AtomicBool,
) -> Result<[f64; 4], String> {
    let output = engine.run(
        super::engine::GdalProgram::Info,
        &[
            "-json".to_string(),
            "--config".to_string(),
            "GDAL_PAM_ENABLED".to_string(),
            "NO".to_string(),
            path.display().to_string(),
        ],
        Some(cancel),
    )?;
    let info: serde_json::Value = serde_json::from_str(&output.stdout)
        .map_err(|e| format!("Unreadable display derivative metadata: {e}"))?;
    let ring = info
        .pointer("/wgs84Extent/coordinates/0")
        .and_then(|ring| ring.as_array())
        .ok_or_else(|| "the display derivative has no geographic extent".to_string())?;
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for point in ring {
        let (Some(lon), Some(lat)) = (
            point.get(0).and_then(|value| value.as_f64()),
            point.get(1).and_then(|value| value.as_f64()),
        ) else {
            continue;
        };
        bounds[0] = bounds[0].min(lon);
        bounds[1] = bounds[1].min(lat);
        bounds[2] = bounds[2].max(lon);
        bounds[3] = bounds[3].max(lat);
    }
    if !bounds.iter().all(|value| value.is_finite()) {
        return Err("the display derivative has no geographic extent".to_string());
    }
    Ok(bounds)
}

/// Remove staging leftovers and published files the registry does not own.
///
/// Runs at startup, when no WebView reader can hold a derivative open, so an
/// unreferenced file can go without racing an admitted read.
pub(super) fn prune_display_derivatives(library: &LidarLibrary) -> Result<(), String> {
    let staging = library.inner.paths.display_cog_staging_dir();
    for entry in std::fs::read_dir(&staging).into_iter().flatten().flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    let owned: HashSet<String> = {
        let display = library.display()?;
        let mut statement = display
            .prepare("SELECT file FROM display_cogs WHERE file != ''")
            .map_err(|e| e.to_string())?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for entry in std::fs::read_dir(library.inner.paths.display_cog_dir())
        .into_iter()
        .flatten()
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !owned.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distant_chunks_form_separate_parts_without_the_gap_between() {
        let reader = Arc::new(WindowReader {
            reader: generation::GenerationReader::Chunks(generation::GenerationChunkReader::new(
                "gen-1",
                generation::RESULT_ROLE,
            )),
            lattice: RasterGrid {
                width: 1024,
                height: 1024,
                geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
            },
            crs_wkt: String::new(),
        });
        // Two adjacent chunks and one 200 chunks away.
        let parts = grouped_parts("gen-1", &reader, vec![(0, 0), (1, 0), (200, 3)]);
        let keys: Vec<&str> = parts.iter().map(|part| part.key.as_str()).collect();
        assert_eq!(keys, ["gen-1-0_0", "gen-1-25_0"]);
        let PartSource::Windows { chunks, .. } = &parts[1].source else {
            panic!("composed part")
        };
        assert_eq!(chunks, &[(200, 3)]);
    }

    #[test]
    fn the_part_sentinel_round_trips_through_its_decimal_tag() {
        assert_eq!(PART_NODATA, -(2.0_f32.powi(127)));
        let tag = format!("{:?}", f64::from(PART_NODATA));
        let parsed: f64 = tag.parse().unwrap();
        assert_eq!(parsed, f64::from(PART_NODATA), "{tag}");
        assert_eq!(parsed as f32, PART_NODATA);
    }

    #[test]
    fn negative_lattice_chunks_group_by_floor() {
        let reader = Arc::new(WindowReader {
            reader: generation::GenerationReader::Chunks(generation::GenerationChunkReader::new(
                "gen-2",
                generation::RESULT_ROLE,
            )),
            lattice: RasterGrid {
                width: 1,
                height: 1,
                geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
            },
            crs_wkt: String::new(),
        });
        let parts = grouped_parts("gen-2", &reader, vec![(-1, -1), (0, 0)]);
        let keys: Vec<&str> = parts.iter().map(|part| part.key.as_str()).collect();
        assert_eq!(keys, ["gen-2--1_-1", "gen-2-0_0"]);
    }
}

#[cfg(test)]
impl LidarLibrary {
    /// Test support: prepare an entity's derivatives synchronously.
    pub(super) fn prepare_display_now(
        &self,
        kind: LidarSampleEntityKind,
        entity_id: &str,
    ) -> Result<(), String> {
        let cancel = AtomicBool::new(false);
        match build_plan(self, kind, entity_id, &cancel)? {
            Planned::Plan(plan) => self.prepare_display_plan(&plan, &cancel),
            Planned::Unavailable(_, message) => Err(message),
        }
    }
}

#[cfg(test)]
mod gdal_tests {
    use super::*;
    use common_types::lidar::LidarMeasurementKind;

    fn plane_source(library: &LidarLibrary, root: &Path, name: &str, origin_x: f64) -> PathBuf {
        let engine = &library.inner.engine;
        let cancel = AtomicBool::new(false);
        let (width, height) = (600u32, 400u32);
        // x-ramp with a NoData hole, so validity must survive conversion.
        let mut values = Vec::with_capacity((width * height) as usize);
        for row in 0..height {
            for column in 0..width {
                let hole = (100..140).contains(&row) && (100..160).contains(&column);
                values.push(if hole { -9999.0 } else { column as f32 * 0.5 });
            }
        }
        let raw = root.join(format!("{name}.raw"));
        super::super::import::write_f32_raw(&raw, &values).unwrap();
        let source = root.join(format!("{name}.tif"));
        super::super::import::raw_to_tif(
            engine,
            &cancel,
            &raw,
            &source,
            &RasterGrid {
                width,
                height,
                geotransform: [origin_x, 1.0, 0.0, 6_806_000.0, 0.0, -1.0],
            },
            "EPSG:2154",
            -9999.0,
        )
        .unwrap();
        source
    }

    fn info(library: &LidarLibrary, path: &str) -> serde_json::Value {
        let output = library
            .inner
            .engine
            .run(
                super::super::engine::GdalProgram::Info,
                &["-json".to_string(), path.to_string()],
                None,
            )
            .unwrap();
        serde_json::from_str(&output.stdout).unwrap()
    }

    /// A published multi-source item is displayed from one content-keyed,
    /// compressed, overviewed derivative per source, top-first, each keeping
    /// its source's own NoData rule; the numeric generation is untouched.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn published_sources_display_from_overviewed_derivatives_in_priority_order() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-display-cog"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let cancel = AtomicBool::new(false);
        let west = plane_source(&library, &root, "west", 445_000.0);
        let east = plane_source(&library, &root, "east", 445_300.0);
        let layer_id = library
            .create_layer("pair", LidarMeasurementKind::GroundElevation, None, false)
            .unwrap();
        let job_id = library.record_import_job(&layer_id).unwrap();
        super::super::import::stage_and_publish(
            &library,
            &job_id,
            &layer_id,
            &[west, east],
            &cancel,
        )
        .unwrap();
        let generation_id = library
            .library_snapshot()
            .unwrap()
            .layers
            .into_iter()
            .find(|layer| layer.id == layer_id)
            .and_then(|layer| layer.generation_id)
            .expect("published head");

        library
            .prepare_display_now(LidarSampleEntityKind::Source, &layer_id)
            .unwrap();
        let descriptor = library
            .display_descriptor(&LidarDisplayRequest {
                kind: LidarSampleEntityKind::Source,
                entity_id: layer_id.clone(),
                expected_generation_id: Some(generation_id.clone()),
                retry: false,
            })
            .unwrap();
        assert_eq!(descriptor.state, LidarDisplayState::Ready, "{descriptor:?}");
        assert_eq!(
            descriptor.generation_id.as_deref(),
            Some(generation_id.as_str())
        );
        assert_eq!(descriptor.assets.len(), 2);
        assert_eq!(descriptor.total_assets, 2);
        // Top-first: the east source was listed last, so it is below the west.
        let display_dir = library.inner.paths.display_cog_dir();
        for asset in &descriptor.assets {
            let path = Path::new(&asset.path);
            assert_eq!(path.parent(), Some(display_dir.as_path()));
            let meta = info(&library, &asset.path);
            let band = &meta["bands"][0];
            assert_eq!(band["noDataValue"].as_f64(), Some(-9999.0), "{meta}");
            assert!(
                band["overviews"]
                    .as_array()
                    .is_some_and(|levels| !levels.is_empty()),
                "overviews: {meta}"
            );
            assert_eq!(
                meta["metadata"]["IMAGE_STRUCTURE"]["COMPRESSION"].as_str(),
                Some("DEFLATE")
            );
            // Lambert-93 near 445 km E / 6806 km N lies around 0.4°W, 48.3°N.
            assert!(
                (-0.5..-0.3).contains(&asset.bounds[0]),
                "{:?}",
                asset.bounds
            );
            assert!(
                (48.2..48.4).contains(&asset.bounds[1]),
                "{:?}",
                asset.bounds
            );
        }
        assert!(descriptor.assets[0].bounds[0] < descriptor.assets[1].bounds[0]);

        // A caller aiming at another generation is told the item moved on.
        let stale = library
            .display_descriptor(&LidarDisplayRequest {
                kind: LidarSampleEntityKind::Source,
                entity_id: layer_id.clone(),
                expected_generation_id: Some("gen-older".to_string()),
                retry: false,
            })
            .unwrap();
        assert_eq!(stale.state, LidarDisplayState::Stale);
        assert!(stale.assets.is_empty());

        // An unpublished item has nothing to draw, which is not an error.
        let empty_id = library
            .create_layer("empty", LidarMeasurementKind::GroundElevation, None, false)
            .unwrap();
        let empty = library
            .display_descriptor(&LidarDisplayRequest {
                kind: LidarSampleEntityKind::Source,
                entity_id: empty_id,
                expected_generation_id: None,
                retry: false,
            })
            .unwrap();
        assert_eq!(empty.state, LidarDisplayState::Unavailable);

        // A second preparation reuses the content-keyed derivatives.
        let before: Vec<_> = descriptor
            .assets
            .iter()
            .map(|asset| std::fs::metadata(&asset.path).unwrap().modified().unwrap())
            .collect();
        library
            .prepare_display_now(LidarSampleEntityKind::Source, &layer_id)
            .unwrap();
        let after: Vec<_> = descriptor
            .assets
            .iter()
            .map(|asset| std::fs::metadata(&asset.path).unwrap().modified().unwrap())
            .collect();
        assert_eq!(before, after);
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod chunk_display_tests {
    use super::*;

    /// A published slope result whose chunks the caller then writes.
    fn seed_chunk_result(library: &LidarLibrary, definition_id: &str, generation_id: &str) {
        let manifest = serde_json::json!({
            "definition_id": definition_id,
            "kind": "slope",
            "source_generation_id": "gen-source",
            "parameters": { "slope_unit": "Degrees", "name": null },
            "engine_version": "test",
            "grid": { "width": 1024, "height": 1024, "geotransform": [0.0, 1.0, 0.0, 0.0, 0.0, -1.0] },
            "crs_wkt": "EPSG:3857",
            "created_at": "0",
        });
        library
            .catalogue()
            .unwrap()
            .execute_batch(&format!(
                "INSERT INTO lidar_source_layers(id, name, measurement_kind, units, created_at)
                 VALUES ('lyr-{definition_id}', 'Source', 'ground-elevation', 'm', '0');
                 INSERT INTO lidar_analysis_definitions
                    (id, layer_id, kind, version, parameters_json, created_at)
                 VALUES ('{definition_id}', 'lyr-{definition_id}', 'slope', 2, '{{\"slope_unit\":\"Degrees\",\"name\":null}}', '0');
                 INSERT INTO lidar_analysis_generations
                    (id, definition_id, source_generation_id, engine_version, state, manifest_json,
                     coverage_cells, min_value, max_value, bounds_3857, published_at,
                     method_id, recipe_version)
                 VALUES ('{generation_id}', '{definition_id}', 'gen-source', 'test', 'ready',
                         '{manifest}', 32, 1, 2, '[0,0,1,1]', '0',
                         'geolibre-projected-slope-v1', 2);
                 INSERT INTO lidar_analysis_heads(definition_id, generation_id)
                 VALUES ('{definition_id}', '{generation_id}');"
            ))
            .unwrap();
    }

    /// A chunked slope result displays from one part per group of occupied
    /// chunks: distant coverage produces two small parts, never one raster
    /// spanning the empty space between them.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn distant_result_chunks_display_as_separate_parts_without_the_gap() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-display-chunks"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        seed_chunk_result(&library, "adef-far", "agen-far");
        let near: Vec<f32> = (0..16)
            .map(|index| if index == 5 { f32::NAN } else { 1.0 })
            .collect();
        let far = vec![2.0f32; 16];
        generation::publish_test_chunk(&library, "agen-far", 0, 0, 4, 4, &near);
        generation::publish_test_chunk(&library, "agen-far", 300, 0, 4, 4, &far);

        library
            .prepare_display_now(LidarSampleEntityKind::Analysis, "adef-far")
            .unwrap();
        let descriptor = library
            .display_descriptor(&LidarDisplayRequest {
                kind: LidarSampleEntityKind::Analysis,
                entity_id: "adef-far".to_string(),
                expected_generation_id: Some("agen-far".to_string()),
                retry: false,
            })
            .unwrap();
        assert_eq!(descriptor.state, LidarDisplayState::Ready, "{descriptor:?}");
        assert_eq!(descriptor.assets.len(), 2, "one part per distant group");
        for asset in &descriptor.assets {
            let output = library
                .inner
                .engine
                .run(
                    super::super::engine::GdalProgram::Info,
                    &["-json".to_string(), asset.path.clone()],
                    None,
                )
                .unwrap();
            let info: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
            assert_eq!(
                info["size"],
                serde_json::json!([1024, 1024]),
                "a part covers its own chunk only"
            );
            // gdalinfo prints a Float32 tag at float precision; the renderer
            // parses the TIFF tag itself, so check the stored text round-trips.
            assert_eq!(
                info["bands"][0]["noDataValue"]
                    .as_f64()
                    .map(|value| value as f32),
                Some(PART_NODATA),
                "invalid cells use the display sentinel"
            );
            assert_eq!(stored_nodata_tag(&asset.path), Some(f64::from(PART_NODATA)));
        }
        // The far part starts 300 chunks east of the near one.
        let west: Vec<f64> = descriptor
            .assets
            .iter()
            .map(|asset| asset.bounds[0])
            .collect();
        assert!(west[1] > west[0], "{west:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The GDAL_NODATA TIFF tag text, parsed as the WASM renderer parses it.
    fn stored_nodata_tag(path: &str) -> Option<f64> {
        let bytes = std::fs::read(path).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        text.split('\0')
            .filter(|chunk| chunk.contains('e') && chunk.starts_with('-'))
            .find_map(|chunk| chunk.trim().parse::<f64>().ok())
    }

    /// A derivative that cannot be written leaves a failed, retryable display
    /// state; the numeric generation is untouched and a retry succeeds once
    /// space returns.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_failed_derivative_write_is_retryable_and_publishes_nothing_partial() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-display-capacity"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        seed_chunk_result(&library, "adef-cap", "agen-cap");
        generation::publish_test_chunk(&library, "agen-cap", 0, 0, 4, 4, &[1.0; 16]);

        {
            let _full = super::super::paths::capacity_probe::override_available(1024);
            let error = library
                .prepare_display_now(LidarSampleEntityKind::Analysis, "adef-cap")
                .unwrap_err();
            assert!(error.contains("needs at least"), "{error}");
        }
        assert!(
            std::fs::read_dir(library.inner.paths.display_cog_dir())
                .unwrap()
                .next()
                .is_none(),
            "nothing partial is published"
        );
        assert!(
            std::fs::read_dir(library.inner.paths.display_cog_staging_dir())
                .unwrap()
                .next()
                .is_none(),
            "the failed write left no staging file"
        );
        library
            .prepare_display_now(LidarSampleEntityKind::Analysis, "adef-cap")
            .unwrap();
        let ready = library
            .display_descriptor(&LidarDisplayRequest {
                kind: LidarSampleEntityKind::Analysis,
                entity_id: "adef-cap".to_string(),
                expected_generation_id: None,
                retry: false,
            })
            .unwrap();
        assert_eq!(ready.state, LidarDisplayState::Ready);
        assert_eq!(ready.assets.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
