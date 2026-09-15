//! Managed filesystem layout for the LiDAR library.
//!
//! The library owns immutable originals, prepared numeric rasters, analysis
//! outputs and the bounded display cache under the app data directory. The
//! `.canopi` document never references these paths.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct LidarPaths {
    root: PathBuf,
}

impl LidarPaths {
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        let root = app_data_dir.join("lidar");
        for dir in [
            root.clone(),
            self_sources_dir(&root),
            self_prepared_dir(&root),
            self_display_dir(&root),
            root.join("jobs"),
        ] {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create LiDAR dir {}: {e}", dir.display()))?;
        }
        Ok(Self { root })
    }

    pub fn catalogue_path(&self) -> PathBuf {
        self.root.join("lidar-library.sqlite")
    }

    pub fn display_cache_path(&self) -> PathBuf {
        self.root.join("lidar-display-cache.sqlite")
    }

    /// Immutable imported originals: `sources/<sha256>/original`.
    pub fn source_dir(&self, sha256: &str) -> PathBuf {
        self.root.join("sources").join(sha256)
    }

    pub fn source_original(&self, sha256: &str) -> PathBuf {
        self.source_dir(sha256).join("original")
    }

    pub fn source_manifest(&self, sha256: &str) -> PathBuf {
        self.source_dir(sha256).join("manifest.json")
    }

    /// Prepared per-layer generation mosaics, staging dirs and coverage masks.
    pub fn layer_pipeline_dir(&self, layer_id: &str) -> PathBuf {
        self.prepared_dir().join("layers").join(layer_id)
    }

    /// Prepared analysis outputs, staging dirs and quality masks.
    pub fn analysis_pipeline_dir(&self, definition_id: &str) -> PathBuf {
        self.prepared_dir().join("analysis").join(definition_id)
    }

    pub fn prepared_dir(&self) -> PathBuf {
        self.root.join("prepared")
    }

    pub fn display_dir(&self) -> PathBuf {
        self.root.join("display")
    }

    /// Bounded display tile pyramid for one published entity generation.
    pub fn display_generation_dir(
        &self,
        entity_kind: &str,
        entity_id: &str,
        generation_id: &str,
        style: &str,
    ) -> PathBuf {
        self.display_dir()
            .join(entity_kind)
            .join(entity_id)
            .join(generation_id)
            .join(style)
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.root.join("jobs")
    }

    /// Per-job scratch directory; removed when the job settles.
    pub fn job_dir(&self, job_id: &str) -> PathBuf {
        self.jobs_dir().join(job_id)
    }
}

fn self_sources_dir(root: &Path) -> PathBuf {
    root.join("sources")
}

fn self_prepared_dir(root: &Path) -> PathBuf {
    root.join("prepared")
}

fn self_display_dir(root: &Path) -> PathBuf {
    root.join("display")
}
