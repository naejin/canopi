// .canopi file format: serialize, deserialize, migrate, autosave
pub mod autosave;
pub mod format;

/// Format a Unix timestamp (seconds since epoch) as an ISO 8601 UTC string.
///
/// Uses a Gregorian calendar algorithm so there is no chrono dependency.
pub fn unix_to_iso8601(secs: u64) -> String {
    let secs_per_day = 86_400u64;
    let days = secs / secs_per_day;
    let tod = secs % secs_per_day;
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;

    // Gregorian calendar conversion from Julian Day Number.
    let jd = days + 2_440_588; // JDN of Unix epoch (1970-01-01)
    let a = jd + 32_044;
    let b = (4 * a + 3) / 146_097;
    let c = a - (b * 146_097) / 4;
    let d = (4 * c + 3) / 1_461;
    let e = c - (1_461 * d) / 4;
    let m = (5 * e + 2) / 153;

    let day = e - (153 * m + 2) / 5 + 1;
    let month = m + 3 - 12 * (m / 10);
    let year = b * 100 + d - 4_800 + m / 10;

    format!("{year:04}-{month:02}-{day:02}T{hh:02}:{mm:02}:{ss:02}Z")
}
