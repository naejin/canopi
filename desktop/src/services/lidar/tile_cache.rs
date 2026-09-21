//! Shared reproducible display cache for on-demand native tiles.
//!
//! Encoded tiles are pure derivatives of an immutable generation and a style,
//! so they may be cached and discarded at will: nothing here is authority, and
//! a missing or interrupted entry only costs a re-render. Two budgets are
//! shared across every source and result generation — an in-memory image cache
//! and a disk cache — and each is enforced by byte accounting with
//! least-recently-used eviction of entries no render currently holds.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Shared in-memory budget for encoded tiles and reduced images.
pub(super) const MEMORY_BUDGET_BYTES: u64 = 128 * 1024 * 1024;
/// Shared reproducible display-disk budget.
pub(super) const DISK_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Style revision in every key, so a ramp change never serves stale pixels.
pub(super) const STYLE_VERSION: u32 = 1;

/// Identity of one cached tile.
///
/// The generation identity is immutable and the style version is explicit, so
/// a hit can only ever be the same pixels; the level is part of the key
/// because the reduction rule depends on it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct TileKey {
    pub generation_id: String,
    pub style: String,
    pub z: u32,
    pub x: u32,
    pub y: u32,
}

impl TileKey {
    fn relative_path(&self) -> PathBuf {
        PathBuf::from(&self.generation_id)
            .join(format!("{}-v{}", self.style, STYLE_VERSION))
            .join(format!("{}_{}_{}.png", self.z, self.x, self.y))
    }
}

struct MemoryEntry {
    bytes: Vec<u8>,
    /// Lower is older.
    tick: u64,
}

/// Bounded, evicting cache of encoded display tiles.
pub(crate) struct DisplayTileCache {
    directory: PathBuf,
    memory_budget: u64,
    disk_budget: u64,
    memory: HashMap<TileKey, MemoryEntry>,
    memory_bytes: u64,
    /// Byte sizes of the entries this session wrote or read, in insertion
    /// order, so disk eviction can pick the oldest without a scan.
    disk_order: Vec<(TileKey, u64)>,
    disk_bytes: u64,
    tick: u64,
    /// Entries a render currently holds: never evicted while leased.
    leased: HashMap<TileKey, u32>,
    hits: u64,
    misses: u64,
}

impl DisplayTileCache {
    /// Open the cache, accounting the entries a previous session left behind.
    pub(crate) fn open(directory: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|e| {
            format!(
                "Failed to create display cache {}: {e}",
                directory.display()
            )
        })?;
        let mut cache = Self {
            directory: directory.to_path_buf(),
            memory_budget: MEMORY_BUDGET_BYTES,
            disk_budget: DISK_BUDGET_BYTES,
            memory: HashMap::new(),
            memory_bytes: 0,
            disk_order: Vec::new(),
            disk_bytes: 0,
            tick: 0,
            leased: HashMap::new(),
            hits: 0,
            misses: 0,
        };
        cache.disk_bytes = directory_bytes(directory);
        cache.evict_disk_to_budget()?;
        Ok(cache)
    }

    #[cfg(test)]
    pub(super) fn with_budgets(
        directory: &Path,
        memory_budget: u64,
        disk_budget: u64,
    ) -> Result<Self, String> {
        let mut cache = Self::open(directory)?;
        cache.memory_budget = memory_budget;
        cache.disk_budget = disk_budget;
        cache.evict_disk_to_budget()?;
        Ok(cache)
    }

    /// Bytes currently held in memory and on disk.
    #[cfg(test)]
    pub(super) fn bytes(&self) -> (u64, u64) {
        (self.memory_bytes, self.disk_bytes)
    }

    /// Cache hits and misses since this cache opened.
    #[cfg(test)]
    pub(super) fn counters(&self) -> (u64, u64) {
        (self.hits, self.misses)
    }

    /// Mark one tile as held by a render, so eviction cannot drop it.
    pub(crate) fn begin(&mut self, key: &TileKey) {
        *self.leased.entry(key.clone()).or_insert(0) += 1;
    }

    /// Release a render's hold on one tile.
    pub(crate) fn end(&mut self, key: &TileKey) {
        self.release(key);
    }

    fn release(&mut self, key: &TileKey) {
        if let Some(count) = self.leased.get_mut(key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.leased.remove(key);
            }
        }
    }

    fn is_leased(&self, key: &TileKey) -> bool {
        self.leased.contains_key(key)
    }

    /// Read one cached tile, preferring memory and refreshing recency.
    pub(crate) fn get(&mut self, key: &TileKey) -> Option<Vec<u8>> {
        self.tick += 1;
        let tick = self.tick;
        if let Some(entry) = self.memory.get_mut(key) {
            entry.tick = tick;
            self.hits += 1;
            return Some(entry.bytes.clone());
        }
        let path = self.directory.join(key.relative_path());
        match std::fs::read(&path) {
            Ok(bytes) => {
                self.hits += 1;
                self.remember(key, bytes.clone(), false);
                Some(bytes)
            }
            Err(_) => {
                self.misses += 1;
                None
            }
        }
    }

    /// Store one freshly rendered tile in both budgets.
    ///
    /// An entry that cannot be admitted is simply not cached: a tile is always
    /// served, and the budget is never exceeded to keep it.
    pub(crate) fn insert(&mut self, key: &TileKey, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.is_empty() {
            return Ok(());
        }
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) <= self.disk_budget {
            self.write_disk(key, &bytes)?;
        }
        self.remember(key, bytes, true);
        Ok(())
    }

    fn remember(&mut self, key: &TileKey, bytes: Vec<u8>, written: bool) {
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if size > self.memory_budget {
            return;
        }
        self.tick += 1;
        if self
            .memory
            .insert(
                key.clone(),
                MemoryEntry {
                    bytes,
                    tick: self.tick,
                },
            )
            .is_none()
        {
            self.memory_bytes = self.memory_bytes.saturating_add(size);
        }
        if !written {
            self.disk_order.push((key.clone(), size));
            self.disk_bytes = self.disk_bytes.saturating_add(size);
        }
        self.evict_memory_to_budget();
    }

    fn write_disk(&mut self, key: &TileKey, bytes: &[u8]) -> Result<(), String> {
        let target = self.directory.join(key.relative_path());
        let parent = target
            .parent()
            .ok_or_else(|| "display cache path has no directory".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create display cache dir: {e}"))?;
        // Owned temp file then rename, so an interrupted write is never a
        // readable entry.
        let temp = parent.join(format!(
            ".{}-{}.tmp",
            target
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "tile".to_string()),
            std::process::id()
        ));
        std::fs::write(&temp, bytes)
            .map_err(|e| format!("Failed to write display cache tile: {e}"))?;
        if let Err(error) = std::fs::rename(&temp, &target) {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("Failed to publish display cache tile: {error}"));
        }
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        self.disk_order.push((key.clone(), size));
        self.disk_bytes = self.disk_bytes.saturating_add(size);
        self.evict_disk_to_budget()
    }

    fn evict_memory_to_budget(&mut self) {
        while self.memory_bytes > self.memory_budget {
            let Some(oldest) = self
                .memory
                .iter()
                .filter(|(key, _)| !self.is_leased(key))
                .min_by_key(|(_, entry)| entry.tick)
                .map(|(key, _)| key.clone())
            else {
                // Everything left is leased: decline to cache more rather than
                // exceeding the budget.
                return;
            };
            if let Some(entry) = self.memory.remove(&oldest) {
                self.memory_bytes = self
                    .memory_bytes
                    .saturating_sub(u64::try_from(entry.bytes.len()).unwrap_or(u64::MAX));
            }
        }
    }

    fn evict_disk_to_budget(&mut self) -> Result<(), String> {
        while self.disk_bytes > self.disk_budget {
            let Some(index) = self
                .disk_order
                .iter()
                .position(|(key, _)| !self.is_leased(key))
            else {
                return Ok(());
            };
            let (key, size) = self.disk_order.remove(index);
            let path = self.directory.join(key.relative_path());
            let _ = std::fs::remove_file(&path);
            self.disk_bytes = self.disk_bytes.saturating_sub(size);
        }
        Ok(())
    }

    /// Drop every cached tile of one generation.
    ///
    /// Called when a layer or analysis is deleted: its immutable generations
    /// can no longer be requested, so their derivatives are not worth keeping.
    pub(crate) fn invalidate_generation(&mut self, generation_id: &str) {
        let prefix = Path::new(generation_id);
        self.memory.retain(|key, entry| {
            if Path::new(&key.generation_id) == prefix {
                self.memory_bytes = self
                    .memory_bytes
                    .saturating_sub(u64::try_from(entry.bytes.len()).unwrap_or(u64::MAX));
                false
            } else {
                true
            }
        });
        let dropped: u64 = self
            .disk_order
            .iter()
            .filter(|(key, _)| key.generation_id == generation_id)
            .map(|(_, size)| *size)
            .sum();
        self.disk_order
            .retain(|(key, _)| key.generation_id != generation_id);
        self.disk_bytes = self.disk_bytes.saturating_sub(dropped);
        let _ = std::fs::remove_dir_all(self.directory.join(prefix));
    }

    /// Remove temporary files an interrupted session left behind.
    pub(crate) fn discard_interrupted_writes(&self) {
        for entry in walk_files(&self.directory) {
            let is_temp = entry
                .file_name()
                .map(|name| {
                    let name = name.to_string_lossy();
                    name.starts_with('.') && name.ends_with(".tmp")
                })
                .unwrap_or(false);
            if is_temp {
                let _ = std::fs::remove_file(&entry);
            }
        }
    }
}

fn directory_bytes(directory: &Path) -> u64 {
    walk_files(directory)
        .into_iter()
        .filter_map(|path| std::fs::metadata(path).ok().map(|meta| meta.len()))
        .fold(0u64, |total, size| total.saturating_add(size))
}

fn walk_files(directory: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![directory.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "canopi-tile-cache-{label}-{}-{}",
            std::process::id(),
            super::super::catalogue::new_id("t")
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn key(generation: &str, x: u32) -> TileKey {
        TileKey {
            generation_id: generation.to_string(),
            style: "elevation".to_string(),
            z: 14,
            x,
            y: 10,
        }
    }

    #[test]
    fn tiles_are_cached_in_memory_and_on_disk() {
        let root = scratch("roundtrip");
        let mut cache = DisplayTileCache::with_budgets(&root, 1024, 4096).unwrap();
        let key = key("gen-1", 1);
        assert!(cache.get(&key).is_none());
        cache.insert(&key, vec![7u8; 64]).unwrap();
        assert_eq!(cache.get(&key), Some(vec![7u8; 64]));
        // One miss for the first lookup, one hit for the second.
        let (hits, misses) = cache.counters();
        assert_eq!((hits, misses), (1, 1));
        assert!(root.join(key.relative_path()).exists());

        // A later session reads the entry back and accounts its bytes.
        drop(cache);
        let mut reopened = DisplayTileCache::with_budgets(&root, 1024, 4096).unwrap();
        assert_eq!(reopened.bytes().1, 64);
        assert_eq!(reopened.get(&key), Some(vec![7u8; 64]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_disk_budget_evicts_the_least_recently_used_entry() {
        let root = scratch("disk-budget");
        let mut cache = DisplayTileCache::with_budgets(&root, 1 << 20, 150).unwrap();
        let first = key("gen-1", 0);
        let second = key("gen-1", 1);
        cache.insert(&first, vec![1u8; 100]).unwrap();
        cache.insert(&second, vec![2u8; 100]).unwrap();
        // The second insert pushes the pair over budget, so the older entry
        // goes and the newer one stays.
        assert!(!root.join(first.relative_path()).exists());
        assert!(root.join(second.relative_path()).exists());
        assert_eq!(cache.bytes().1, 100);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_leased_entry_is_never_evicted() {
        let root = scratch("lease");
        let mut cache = DisplayTileCache::with_budgets(&root, 1 << 20, 200).unwrap();
        let held = key("gen-1", 0);
        cache.begin(&held);
        cache.insert(&held, vec![1u8; 100]).unwrap();
        cache.insert(&key("gen-1", 1), vec![2u8; 100]).unwrap();
        // Eviction declines rather than dropping the leased entry.
        assert!(root.join(held.relative_path()).exists());
        cache.end(&held);
        cache.insert(&key("gen-1", 2), vec![3u8; 100]).unwrap();
        assert!(!root.join(held.relative_path()).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_memory_budget_evicts_without_touching_the_disk_copy() {
        let root = scratch("memory-budget");
        let mut cache = DisplayTileCache::with_budgets(&root, 120, 1 << 20).unwrap();
        let first = key("gen-1", 0);
        let second = key("gen-1", 1);
        cache.insert(&first, vec![1u8; 100]).unwrap();
        cache.insert(&second, vec![2u8; 100]).unwrap();
        assert!(cache.bytes().0 <= 120, "memory budget held");
        // The evicted entry is still a disk hit, so it is served without a
        // render.
        assert_eq!(cache.get(&first), Some(vec![1u8; 100]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_oversized_tile_is_served_but_not_cached() {
        let root = scratch("oversized");
        let mut cache = DisplayTileCache::with_budgets(&root, 16, 32).unwrap();
        let key = key("gen-1", 3);
        cache.insert(&key, vec![9u8; 64]).unwrap();
        assert_eq!(cache.bytes(), (0, 0));
        assert!(cache.get(&key).is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn invalidating_a_generation_drops_its_tiles_only() {
        let root = scratch("invalidate");
        let mut cache = DisplayTileCache::with_budgets(&root, 1 << 20, 1 << 20).unwrap();
        let doomed = key("gen-1", 0);
        let kept = key("gen-2", 0);
        cache.insert(&doomed, vec![1u8; 32]).unwrap();
        cache.insert(&kept, vec![2u8; 32]).unwrap();
        cache.invalidate_generation("gen-1");
        assert!(!root.join(doomed.relative_path()).exists());
        assert!(root.join(kept.relative_path()).exists());
        assert_eq!(cache.get(&doomed), None);
        assert_eq!(cache.get(&kept), Some(vec![2u8; 32]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_writes_are_not_readable_entries() {
        let root = scratch("interrupted");
        let cache = DisplayTileCache::with_budgets(&root, 1 << 20, 1 << 20).unwrap();
        let leftover = root.join("gen-1").join("elevation-v1");
        std::fs::create_dir_all(&leftover).unwrap();
        std::fs::write(leftover.join(".14_0_0.png-1234.tmp"), b"partial").unwrap();
        std::fs::write(leftover.join("14_0_0.png"), b"complete").unwrap();
        cache.discard_interrupted_writes();
        assert!(!leftover.join(".14_0_0.png-1234.tmp").exists());
        assert!(leftover.join("14_0_0.png").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
