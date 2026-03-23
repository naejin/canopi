/// Platform-specific native operations.
/// Each OS implements this via its native lib (lib-swift, lib-cpp, lib-c).
pub trait Platform {
    fn register_file_type() -> Result<(), String>;
}

/// Stub implementation for development — replaced by native libs in Phase 3+.
pub struct StubPlatform;

impl Platform for StubPlatform {
    fn register_file_type() -> Result<(), String> {
        Ok(())
    }
}

// Conditional platform selection — native impls added in Phase 3+
pub type NativePlatform = StubPlatform;
