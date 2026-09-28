//! `sources/<sha256>/meta.json`: the authored facts about one imported
//! original, kept beside it so a catalogue can be rebuilt from the files.
//!
//! The catalogue stays the authority; this file is a derived record rewritten
//! from the catalogue after every publication, rename, analysis definition or
//! deletion. It carries what no raster read can recover: the item's name,
//! quantity and units, the order of its member originals, and the analyses
//! defined over it. Everything measured from pixels (COGs, chunks, ranges,
//! results) is left out and recomputed on demand after a rebuild.
//!
//! A meta whose `items` is empty says the original belongs to no published
//! item; a missing meta says nothing is known, and recovery lists such an
//! original under a generated name rather than losing it.

use super::catalogue;
use super::paths::LidarPaths;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

pub const META_FILE: &str = "meta.json";
pub const META_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceMeta {
    pub version: u32,
    pub sha256: String,
    pub original_filename: String,
    pub size_bytes: u64,
    pub imported_at: String,
    /// Published items this original is a member of, in creation order.
    pub items: Vec<ItemMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ItemMeta {
    pub id: String,
    pub name: String,
    /// `RasterQuantity::key` of an importable quantity.
    pub quantity: String,
    pub units: String,
    pub created_at: String,
    /// Member originals in priority order (sha256 each); position 0 is topmost.
    pub members: Vec<String>,
    /// Analyses reading this item or an item derived from it.
    pub analyses: Vec<AnalysisMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisMeta {
    pub definition_id: String,
    pub analysis_id: String,
    pub parameters: serde_json::Value,
    pub outputs: serde_json::Value,
    pub created_at: String,
    pub inputs: Vec<AnalysisInputMeta>,
    pub items: Vec<DerivedItemMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisInputMeta {
    pub input_key: String,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DerivedItemMeta {
    pub id: String,
    pub output_key: String,
    pub quantity: String,
    pub units: String,
    pub name: Option<String>,
    pub created_at: String,
}

/// Derive the meta of every recorded original from the catalogue.
pub fn derive_all(connection: &Connection) -> Result<Vec<SourceMeta>, String> {
    let mut metas: BTreeMap<String, SourceMeta> = {
        let mut statement = connection
            .prepare(
                "SELECT sha256, original_filename, size_bytes, imported_at
                 FROM lidar_sources ORDER BY sha256",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(SourceMeta {
                    version: META_VERSION,
                    sha256: row.get(0)?,
                    original_filename: row.get(1)?,
                    size_bytes: row.get::<_, i64>(2)?.max(0) as u64,
                    imported_at: row.get(3)?,
                    items: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows.into_iter()
            .map(|meta| (meta.sha256.clone(), meta))
            .collect()
    };
    let analyses = all_analyses(connection)?;

    let mut layers = connection
        .prepare(
            "SELECT id, name, quantity, units, created_at
             FROM lidar_source_layers ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let layer_rows = layers
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (id, name, quantity, units, created_at) in layer_rows {
        let Some(head) = catalogue::head_generation(connection, &id)? else {
            continue;
        };
        let mut members = Vec::new();
        for member in catalogue::collection_members(connection, &head.id)? {
            let sha256: String = connection
                .query_row(
                    "SELECT source_sha256 FROM lidar_interpretations WHERE id = ?1",
                    [&member.interpretation_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Failed to read a member's source: {e}"))?;
            members.push(sha256);
        }
        let item = ItemMeta {
            id: id.clone(),
            name,
            quantity,
            units,
            created_at,
            members: members.clone(),
            analyses: analyses_over(&id, &analyses),
        };
        let mut seen = HashSet::new();
        for sha256 in members {
            if !seen.insert(sha256.clone()) {
                continue;
            }
            if let Some(meta) = metas.get_mut(&sha256) {
                meta.items.push(item.clone());
            }
        }
    }
    Ok(metas.into_values().collect())
}

fn all_analyses(connection: &Connection) -> Result<Vec<AnalysisMeta>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, analysis_id, parameters_json, outputs_json, created_at
             FROM lidar_analysis_definitions ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut analyses = Vec::with_capacity(rows.len());
    for (definition_id, analysis_id, parameters_json, outputs_json, created_at) in rows {
        let inputs = catalogue::definition_inputs(connection, &definition_id)?
            .into_iter()
            .map(|input| AnalysisInputMeta {
                input_key: input.input_key,
                item_id: input.item_id,
            })
            .collect();
        let mut items_statement = connection
            .prepare(
                "SELECT id, output_key, quantity, units, name, created_at
                 FROM lidar_derived_items WHERE definition_id = ?1 ORDER BY output_key",
            )
            .map_err(|e| e.to_string())?;
        let items = items_statement
            .query_map([&definition_id], |row| {
                Ok(DerivedItemMeta {
                    id: row.get(0)?,
                    output_key: row.get(1)?,
                    quantity: row.get(2)?,
                    units: row.get(3)?,
                    name: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        analyses.push(AnalysisMeta {
            definition_id,
            analysis_id,
            parameters: serde_json::from_str(&parameters_json)
                .unwrap_or(serde_json::Value::Array(Vec::new())),
            outputs: serde_json::from_str(&outputs_json)
                .unwrap_or(serde_json::Value::Array(Vec::new())),
            created_at,
            inputs,
            items,
        });
    }
    Ok(analyses)
}

/// The analyses reachable from `item_id`: those reading it, then those
/// reading their outputs, in definition order.
fn analyses_over(item_id: &str, analyses: &[AnalysisMeta]) -> Vec<AnalysisMeta> {
    let mut known: BTreeSet<String> = BTreeSet::from([item_id.to_string()]);
    let mut taken = vec![false; analyses.len()];
    let mut result = Vec::new();
    loop {
        let mut grew = false;
        for (index, analysis) in analyses.iter().enumerate() {
            if taken[index]
                || !analysis
                    .inputs
                    .iter()
                    .any(|input| known.contains(&input.item_id))
            {
                continue;
            }
            taken[index] = true;
            grew = true;
            for item in &analysis.items {
                known.insert(item.id.clone());
            }
            result.push(analysis.clone());
        }
        if !grew {
            break;
        }
    }
    result
}

/// Write every original's meta beside it; an original no longer on disk is
/// skipped. Returns how many files changed.
pub fn refresh(connection: &Connection, paths: &LidarPaths) -> Result<usize, String> {
    let mut written = 0;
    for meta in derive_all(connection)? {
        if !paths.source_original(&meta.sha256).is_file() {
            continue;
        }
        if write(&paths.source_meta(&meta.sha256), &meta)? {
            written += 1;
        }
    }
    Ok(written)
}

/// Write `meta` to `path` atomically; unchanged content is left alone.
/// Returns whether the file changed.
pub fn write(path: &Path, meta: &SourceMeta) -> Result<bool, String> {
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to encode source meta: {e}"))?;
    if let Ok(existing) = std::fs::read_to_string(path)
        && existing == json
    {
        return Ok(false);
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json.as_bytes())
        .map_err(|e| format!("Failed to write {}: {e}", temporary.display()))?;
    std::fs::rename(&temporary, path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        format!("Failed to publish {}: {e}", path.display())
    })?;
    Ok(true)
}

/// Read one original's meta; `None` when absent or unreadable (recovery then
/// treats the original as unknown).
pub fn read(path: &Path) -> Option<SourceMeta> {
    let json = std::fs::read_to_string(path).ok()?;
    let meta: SourceMeta = serde_json::from_str(&json).ok()?;
    (meta.version == META_VERSION).then_some(meta)
}

/// Item metas across a set of source metas, one per item id, in creation order.
pub fn distinct_items(metas: &[SourceMeta]) -> Vec<ItemMeta> {
    let mut by_id: HashMap<String, ItemMeta> = HashMap::new();
    for meta in metas {
        for item in &meta.items {
            by_id.entry(item.id.clone()).or_insert_with(|| item.clone());
        }
    }
    let mut items: Vec<ItemMeta> = by_id.into_values().collect();
    items.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
    items
}

#[cfg(test)]
pub(crate) mod test_support {
    use rusqlite::Connection;

    /// Catalogue rows of one published source item over `members`
    /// (sha256, filename), in priority order, without any raster on disk.
    pub(crate) fn seed_published_item(
        connection: &Connection,
        layer_id: &str,
        name: &str,
        quantity: &str,
        units: &str,
        members: &[(&str, &str)],
    ) {
        connection
            .execute(
                "INSERT INTO lidar_source_layers(id, name, item_kind, quantity, units, created_at)
                 VALUES(?1, ?2, 'raster', ?3, ?4, ?1)",
                rusqlite::params![layer_id, name, quantity, units],
            )
            .unwrap();
        let generation_id = format!("gen-{layer_id}");
        connection
            .execute(
                "INSERT INTO lidar_layer_generations(id, layer_id, created_at, manifest_json, bounds_3857, crs_class)
                 VALUES(?1, ?2, '1', '{}', '[0,0,1,1]', 'projected-metre')",
                rusqlite::params![generation_id, layer_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES(?1, ?2)",
                rusqlite::params![layer_id, generation_id],
            )
            .unwrap();
        for (position, (sha256, filename)) in members.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
                     VALUES(?1, ?2, 3, '{}', '1') ON CONFLICT(sha256) DO NOTHING",
                    rusqlite::params![sha256, filename],
                )
                .unwrap();
            let interpretation_id = format!("interp-{layer_id}-{sha256}");
            connection
                .execute(
                    "INSERT INTO lidar_interpretations(
                        id, source_sha256, band_index, quantity, units, scale, offset, crs_wkt,
                        vertical_ref, geotransform, width, height, interp_hash, valid_cells)
                     VALUES(?1, ?2, 1, ?3, ?4, 1, 0, 'EPSG:2154', 'unspecified', '0,1,0,0,0,-1', 1, 1, ?1, 1)",
                    rusqlite::params![interpretation_id, sha256, quantity, units],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_collection_members(generation_id, member_id, position, interpretation_id, created_at)
                     VALUES(?1, ?2, ?3, ?4, '1')",
                    rusqlite::params![
                        generation_id,
                        format!("mem-{layer_id}-{position}"),
                        position as i64,
                        interpretation_id
                    ],
                )
                .unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::analyses::test_support::seed_published_slope;
    use super::super::catalogue;
    use super::*;
    use common_types::library::RasterQuantity;

    fn fresh_catalogue() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        catalogue::create_schema(&connection).unwrap();
        connection
    }

    /// The meta of a member records its item's name, quantity, units, the
    /// full member order and every analysis defined over the item, including
    /// one over a result of it.
    #[test]
    fn a_members_meta_carries_the_item_and_its_analyses() {
        let connection = fresh_catalogue();
        test_support::seed_published_item(
            &connection,
            "lyr-a",
            "Orchard ground",
            RasterQuantity::GroundElevation.key(),
            "m",
            &[("sha-1", "tile-1.tif"), ("sha-2", "tile-2.tif")],
        );
        seed_published_slope(
            &connection,
            "lyr-a",
            "gen-lyr-a",
            "adef-1",
            "item-slope",
            "dgen-1",
            Some("Slope"),
        );
        // A second analysis over the slope result (a chain), and one over an
        // unrelated item that must not appear.
        test_support::seed_published_item(
            &connection,
            "lyr-b",
            "Other",
            RasterQuantity::GroundElevation.key(),
            "m",
            &[("sha-3", "b.tif")],
        );
        seed_published_slope(
            &connection,
            "item-slope",
            "dgen-1",
            "adef-2",
            "item-chain",
            "dgen-2",
            None,
        );
        seed_published_slope(
            &connection,
            "lyr-b",
            "gen-lyr-b",
            "adef-3",
            "item-other",
            "dgen-3",
            None,
        );

        let metas = derive_all(&connection).unwrap();
        assert_eq!(metas.len(), 3);
        let second = metas.iter().find(|meta| meta.sha256 == "sha-2").unwrap();
        assert_eq!(second.original_filename, "tile-2.tif");
        assert_eq!(second.items.len(), 1);
        let item = &second.items[0];
        assert_eq!(item.name, "Orchard ground");
        assert_eq!(item.quantity, RasterQuantity::GroundElevation.key());
        assert_eq!(item.units, "m");
        assert_eq!(item.members, vec!["sha-1", "sha-2"]);
        let definitions: Vec<&str> = item
            .analyses
            .iter()
            .map(|analysis| analysis.definition_id.as_str())
            .collect();
        assert_eq!(definitions, vec!["adef-1", "adef-2"]);
        assert_eq!(item.analyses[0].items[0].name.as_deref(), Some("Slope"));
        assert_eq!(item.analyses[0].inputs[0].item_id, "lyr-a");
        let other = metas.iter().find(|meta| meta.sha256 == "sha-3").unwrap();
        assert_eq!(other.items[0].analyses.len(), 1);
    }

    /// Writing is atomic and idempotent, and a meta of another version is not
    /// trusted.
    #[test]
    fn meta_round_trips_and_an_unknown_version_reads_as_absent() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-source-meta"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(META_FILE);
        let meta = SourceMeta {
            version: META_VERSION,
            sha256: "abc".into(),
            original_filename: "a.tif".into(),
            size_bytes: 3,
            imported_at: "1".into(),
            items: Vec::new(),
        };
        assert!(write(&path, &meta).unwrap());
        assert!(
            !write(&path, &meta).unwrap(),
            "unchanged content is not rewritten"
        );
        assert_eq!(read(&path), Some(meta.clone()));
        assert!(!root.join("meta.json.tmp").exists());
        let newer = SourceMeta {
            version: META_VERSION + 1,
            ..meta
        };
        std::fs::write(&path, serde_json::to_string(&newer).unwrap()).unwrap();
        assert_eq!(read(&path), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
