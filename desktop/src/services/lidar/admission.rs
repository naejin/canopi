//! Interim admission policy for new imports and replacements.
//!
//! Until every capacity gate passes, a **new** import or replacement is
//! admitted only inside these bounds: at most 16 source files, at most 512 MiB
//! per source, at most 1 GiB of selected sources, and at most 25,000,000 cells
//! in the resulting import/replacement union envelope.
//!
//! One policy serves every caller — selection validation, the managed-original
//! copy/hash, review staging and Apply — so a bound cannot hold on one storage
//! branch and be skipped on another, and no hidden ceiling in a copy loop can
//! invalidate an authorized run. Reads, display, deletion and undo of
//! generations that already exist are deliberately **not** subject to it:
//! grandfathered immutable history stays readable however large it is, and undo
//! restores accepted history rather than admitting new input.
//!
//! Representative large-fixture runs raise the bounds for their own thread
//! through the test-only [`limits_probe`]; nothing in a production build can,
//! and no environment variable can enable a production bypass.

use std::path::Path;

/// Most source files one import may select.
pub(crate) const MAX_SOURCE_FILES_PER_IMPORT: usize = 16;
/// Most bytes one selected source file may occupy.
pub(crate) const MAX_SOURCE_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Most bytes all selected sources of one import may occupy together.
pub(crate) const MAX_IMPORT_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;
/// Most cells the resulting import/replacement union envelope may span.
///
/// This is an admission bound on new work, not a property of the storage
/// format: a sparse publication inside it never allocates by that area, but the
/// envelope bound still applies to it exactly as it does to a dense one.
pub(crate) const MAX_IMPORT_UNION_CELLS: u64 = 25_000_000;

/// The bounds in force for one admission decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AdmissionLimits {
    pub files: usize,
    pub source_bytes: u64,
    pub import_bytes: u64,
    pub union_cells: u64,
}

impl AdmissionLimits {
    pub(crate) const fn production() -> Self {
        Self {
            files: MAX_SOURCE_FILES_PER_IMPORT,
            source_bytes: MAX_SOURCE_FILE_BYTES,
            import_bytes: MAX_IMPORT_SOURCE_BYTES,
            union_cells: MAX_IMPORT_UNION_CELLS,
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

/// Refuse a union envelope that spans more cells than the policy allows.
///
/// `what` names the step so a refusal says which union was too large. The cell
/// count is arithmetic over the envelope's dimensions, so a separated pair of
/// small sources is refused by its envelope rather than by its data.
pub(crate) fn check_union_envelope(cells: u64, what: &str) -> Result<(), String> {
    let limits = limits();
    if cells > limits.union_cells {
        return Err(format!(
            "{what} spans {cells} cells, above the {} cell import envelope limit; \
             select sources whose combined extent is smaller",
            limits.union_cells
        ));
    }
    Ok(())
}

/// The envelope's cell count, with checked arithmetic.
pub(crate) fn union_envelope_cells(width: u32, height: u32) -> Result<u64, String> {
    u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "import envelope dimensions overflow".to_string())
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
            union_cells: cells,
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
    fn the_envelope_bound_admits_exactly_its_limit() {
        let limits = AdmissionLimits::production();
        assert_eq!(limits.union_cells, 25_000_000);
        assert!(check_union_envelope(25_000_000, "import review").is_ok());
        let refused = check_union_envelope(25_000_001, "import review").unwrap_err();
        assert!(refused.contains("import review"), "{refused}");
        assert!(refused.contains("25000000"), "{refused}");
        // The arithmetic that produces the count is checked, not saturating.
        assert_eq!(union_envelope_cells(5000, 5000).unwrap(), 25_000_000);
        assert_eq!(union_envelope_cells(5001, 5000).unwrap(), 25_005_000);
        // Two u32 dimensions always multiply exactly into u64, so the count is
        // never saturated; the policy, not the arithmetic, is the bound.
        assert_eq!(
            union_envelope_cells(u32::MAX, u32::MAX).unwrap(),
            u64::from(u32::MAX) * u64::from(u32::MAX)
        );
    }

    #[test]
    fn the_file_and_byte_bounds_admit_exactly_their_limits() {
        let limits = AdmissionLimits::production();
        assert!(check_source_count(limits.files).is_ok());
        assert!(check_source_count(limits.files + 1).is_err());
        let path = Path::new("/library/source.tif");
        assert!(check_source_bytes(path, limits.source_bytes).is_ok());
        assert!(check_source_bytes(path, limits.source_bytes + 1).is_err());
        assert!(check_import_bytes(limits.import_bytes).is_ok());
        assert!(check_import_bytes(limits.import_bytes + 1).is_err());
    }

    #[test]
    fn overrides_are_thread_local_and_expire_with_their_guard() {
        assert_eq!(limits(), AdmissionLimits::production());
        {
            let _guard = limits_probe::raise(64 * 1024 * 1024, 64, 8 * 1024 * 1024 * 1024);
            let raised = limits();
            assert_eq!(raised.union_cells, 64 * 1024 * 1024);
            assert_eq!(raised.files, 64);
            assert!(check_union_envelope(48_000_000, "import review").is_ok());
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
                union_cells: 16,
            };
            let _guard = limits_probe::set(lowered);
            assert_eq!(limits(), lowered);
            assert!(check_source_bytes(Path::new("/library/big.tif"), 2048).is_err());
        }
        assert_eq!(limits(), AdmissionLimits::production());
    }
}
