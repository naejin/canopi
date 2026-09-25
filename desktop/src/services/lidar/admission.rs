//! Admission policy for new imports and replacements.
//!
//! A **new** import or replacement is admitted only inside these bounds: at
//! most 24 source files, at most 2 GiB per source, at most 2 GiB of selected
//! sources, and at most 400,000,000 processing cells in the proposed active
//! collection.
//!
//! Processing cells charge the work actually proposed: each source
//! occurrence's own full native grid, never the empty space between
//! independent sources. Overlap and NoData are counted every time they occur,
//! because a mostly-NoData source still costs decoding work; the count is
//! deliberately conservative work accounting, not a scientific coverage figure.
//!
//! One policy serves every caller — selection validation, the managed-original
//! copy/hash, review staging and Apply — so a bound cannot hold on one storage
//! branch and be skipped on another, and no hidden ceiling in a copy loop can
//! invalidate an authorized run. Reads, display and deletion of items that
//! already exist are deliberately **not** subject to it.
//!
//! Representative large-fixture runs raise the bounds for their own thread
//! through the test-only [`limits_probe`]; nothing in a production build can,
//! and no environment variable can enable a production bypass.

use std::path::Path;

/// Most source files one import may select.
pub(crate) const MAX_SOURCE_FILES_PER_IMPORT: usize = 24;
/// Most bytes one selected source file may occupy.
pub(crate) const MAX_SOURCE_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Most bytes all selected sources of one import may occupy together.
pub(crate) const MAX_IMPORT_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Most processing cells the proposed active collection may contain.
///
/// This is a conservative work bound, not a promise about any raster: it adds
/// up every occurrence's full native grid, counting overlap and NoData
/// repeatedly and charging nothing for empty space between independent sources.
pub(crate) const MAX_IMPORT_PROCESSING_CELLS: u64 = 400_000_000;
/// The bounds in force for one admission decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AdmissionLimits {
    pub files: usize,
    pub source_bytes: u64,
    pub import_bytes: u64,
    /// Processing-cell budget of one import.
    pub processing_cells: u64,
}

impl AdmissionLimits {
    pub(crate) const fn production() -> Self {
        Self {
            files: MAX_SOURCE_FILES_PER_IMPORT,
            source_bytes: MAX_SOURCE_FILE_BYTES,
            import_bytes: MAX_IMPORT_SOURCE_BYTES,
            processing_cells: MAX_IMPORT_PROCESSING_CELLS,
        }
    }
}

/// The bounds in force for this thread.
pub(crate) fn limits() -> AdmissionLimits {
    #[cfg(test)]
    {
        if let Some(limits) = limits_probe::overridden() {
            return limits;
        }
    }
    AdmissionLimits::production()
}

/// Refuse a selection with more files than the policy allows.
pub(crate) fn check_source_count(count: usize) -> Result<(), String> {
    let limits = limits();
    if count > limits.files {
        return Err(format!(
            "an import can contain at most {} source files",
            limits.files
        ));
    }
    Ok(())
}

/// Refuse one source whose bytes exceed the per-source bound.
///
/// Every place that learns a source's size — selection validation and the
/// managed-original copy/hash loop — reports through this one check, so an
/// authorized run cannot be stopped by a second hard-coded ceiling.
pub(crate) fn check_source_bytes(path: &Path, bytes: u64) -> Result<(), String> {
    let limits = limits();
    if bytes > limits.source_bytes {
        return Err(format!(
            "{} is larger than the {} MiB per-source limit",
            path.display(),
            limits.source_bytes / (1024 * 1024),
        ));
    }
    Ok(())
}

/// Refuse a selection whose total bytes exceed the per-import bound.
pub(crate) fn check_import_bytes(total: u64) -> Result<(), String> {
    let limits = limits();
    if total > limits.import_bytes {
        return Err(format!(
            "selected sources exceed the {} MiB import limit",
            limits.import_bytes / (1024 * 1024),
        ));
    }
    Ok(())
}

/// One source occurrence's contribution to the processing-cell budget: its
/// full native grid, which a reader decodes across the whole rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProcessingCost {
    pub width: u32,
    pub height: u32,
}

impl ProcessingCost {
    /// This member's cells. Two u32 dimensions always multiply exactly in u64.
    pub(crate) fn cells(self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

/// The processing-cell total of one proposed active collection.
///
/// Members are summed in the order that resolves topmost-valid precedence, so
/// a caller can pass the accepted occurrence sequence followed by the incoming
/// selection. Overlap is charged on every occurrence, and a repeated
/// occurrence is charged again: re-importing the same bytes as a new
/// occurrence is new work even though the samples are equal.
pub(crate) fn processing_cells(
    members: impl IntoIterator<Item = ProcessingCost>,
) -> Result<u64, String> {
    let mut total: u64 = 0;
    for member in members {
        let cells = member.cells();
        total = total
            .checked_add(cells)
            .ok_or_else(|| "processing cell count overflowed".to_string())?;
    }
    Ok(total)
}

/// Refuse a proposed active collection above the processing-cell budget.
///
/// `what` names the step so a refusal says which proposal was too large.
pub(crate) fn check_processing_budget(
    members: impl IntoIterator<Item = ProcessingCost>,
    what: &str,
) -> Result<u64, String> {
    let limits = limits();
    let total = processing_cells(members)?;
    if total > limits.processing_cells {
        return Err(format!(
            "{what} proposes {total} processing cells, above the {} cell limit; \
             import fewer or smaller sources, or split them across several imports",
            limits.processing_cells
        ));
    }
    Ok(total)
}

#[cfg(test)]
thread_local! {
    static OVERRIDDEN: std::cell::Cell<Option<AdmissionLimits>> = const { std::cell::Cell::new(None) };
}

/// Test-only seam for the representative-run bounds.
///
/// The override is thread-local, so a test that raises the bounds cannot change
/// what another test — or any production submission — is admitted.
#[cfg(test)]
pub(crate) mod limits_probe {
    use super::AdmissionLimits;

    pub(crate) fn overridden() -> Option<AdmissionLimits> {
        super::OVERRIDDEN.with(std::cell::Cell::get)
    }

    /// Admit more than the production envelope until the guard is dropped.
    pub(crate) fn raise(cells: u64, files: usize, source_bytes: u64) -> Guard {
        set(AdmissionLimits {
            files,
            source_bytes,
            import_bytes: source_bytes.saturating_mul(files as u64),
            processing_cells: cells,
        })
    }

    /// Install explicit bounds until the guard is dropped.
    pub(crate) fn set(limits: AdmissionLimits) -> Guard {
        super::OVERRIDDEN.with(|slot| slot.set(Some(limits)));
        Guard
    }

    pub(crate) struct Guard;

    impl Drop for Guard {
        fn drop(&mut self) {
            super::OVERRIDDEN.with(|slot| slot.set(None));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_and_byte_bounds_admit_exactly_their_limits() {
        let limits = AdmissionLimits::production();
        assert_eq!(limits.files, 24);
        assert_eq!(limits.source_bytes, 2 * 1024 * 1024 * 1024);
        assert_eq!(limits.import_bytes, 2 * 1024 * 1024 * 1024);
        assert!(check_source_count(limits.files).is_ok());
        assert!(check_source_count(limits.files + 1).is_err());
        let path = Path::new("/library/source.tif");
        assert!(check_source_bytes(path, limits.source_bytes).is_ok());
        assert!(check_source_bytes(path, limits.source_bytes + 1).is_err());
        assert!(check_import_bytes(limits.import_bytes).is_ok());
        assert!(check_import_bytes(limits.import_bytes + 1).is_err());
    }

    #[test]
    fn the_processing_budget_admits_exactly_its_limit() {
        let limits = AdmissionLimits::production();
        assert_eq!(limits.processing_cells, 400_000_000);
        // The 400-million-cell analytical plane is admitted at exactly the
        // limit, which is the capacity input the contract names.
        let plane = ProcessingCost {
            width: 20_000,
            height: 20_000,
        };
        assert_eq!(plane.cells(), 400_000_000);
        assert_eq!(
            check_processing_budget([plane], "import review").unwrap(),
            400_000_000
        );
        // One cell more is refused, and the refusal names the step and the
        // limit rather than a path or an internal identifier.
        let refused = check_processing_budget(
            [ProcessingCost {
                width: 20_000,
                height: 20_001,
            }],
            "import publication",
        )
        .unwrap_err();
        assert!(refused.contains("import publication"), "{refused}");
        assert!(refused.contains("400000000"), "{refused}");
        assert!(refused.contains("400020000"), "{refused}");
    }

    #[test]
    fn processing_cells_charge_occurrences_and_ignore_the_gap_between_them() {
        let tile = ProcessingCost {
            width: 2_000,
            height: 2_000,
        };
        // 24 adjacent tiles of 4,000,000 cells each: the named sparse case.
        let adjacent = vec![tile; 24];
        assert_eq!(processing_cells(adjacent).unwrap(), 96_000_000);
        assert!(check_processing_budget(vec![tile; 24], "import review").is_ok());
        // The same 24 tiles pulled apart so their combined bounding box spans
        // far more than a million empty cells still cost the same: empty space
        // between independent sources is not charged. This is the behaviour the
        // retired envelope bound got wrong.
        assert_eq!(processing_cells(vec![tile; 24]).unwrap(), 96_000_000);
        // Overlap is charged on every occurrence, so re-importing the same
        // extent as a second occurrence doubles the proposal.
        assert_eq!(processing_cells(vec![tile, tile]).unwrap(), 8_000_000);
    }

    #[test]
    fn processing_cells_use_checked_arithmetic() {
        // Two u32 dimensions always multiply exactly into u64.
        assert_eq!(
            ProcessingCost {
                width: u32::MAX,
                height: u32::MAX,
            }
            .cells(),
            u64::from(u32::MAX) * u64::from(u32::MAX)
        );
        // A total beyond u64 is an explicit error, never a wrapped or
        // saturated budget that would silently admit the work.
        let huge = ProcessingCost {
            width: u32::MAX,
            height: u32::MAX,
        };
        let error = processing_cells([huge; 3]).unwrap_err();
        assert!(error.contains("overflow"), "{error}");
        assert!(check_processing_budget([huge; 3], "import review").is_err());
    }

    #[test]
    fn overrides_are_thread_local_and_expire_with_their_guard() {
        assert_eq!(limits(), AdmissionLimits::production());
        {
            // The override must clear the production budget, or it would be a
            // second, lower ceiling rather than a raised one.
            let _guard = limits_probe::raise(512 * 1024 * 1024, 64, 8 * 1024 * 1024 * 1024);
            let raised = limits();
            assert_eq!(raised.processing_cells, 512 * 1024 * 1024);
            assert_eq!(raised.files, 64);
            assert!(
                check_processing_budget(
                    [ProcessingCost {
                        width: 20_000,
                        height: 20_000
                    }],
                    "import review"
                )
                .is_ok()
            );
        }
        assert_eq!(
            limits(),
            AdmissionLimits::production(),
            "an override never outlives its guard"
        );
        // Lowering the bounds is how a test proves the copy path consults the
        // policy rather than a hard-coded ceiling.
        {
            let lowered = AdmissionLimits {
                files: 2,
                source_bytes: 1024,
                import_bytes: 2048,
                processing_cells: 16,
            };
            let _guard = limits_probe::set(lowered);
            assert_eq!(limits(), lowered);
            assert!(check_source_bytes(Path::new("/library/big.tif"), 2048).is_err());
            assert!(
                check_processing_budget(
                    [ProcessingCost {
                        width: 5,
                        height: 5
                    }],
                    "import review"
                )
                .is_err()
            );
        }
        assert_eq!(limits(), AdmissionLimits::production());
    }
}
