//! The Swiss Oblique Mercator (EPSG method 9815 with azimuth 90°, PROJ
//! `somerc`) behind CH1903+ / LV95 (EPSG:2056) and CH1903 / LV03 (EPSG:21781).
//!
//! `wbprojection` 0.3.3 registers both codes as Oblique Stereographic and
//! its Hotine variant does not reproduce the Swiss grid either (hundreds of
//! metres off across the country), so the engine carries swisstopo's
//! rigorous formulas ("Formulas and constants for the calculation of the
//! Swiss conformal cylindrical projection", 2016): ellipsoid to conformal
//! sphere, then an oblique equatorial cylinder. The datum step (CH1903+ to
//! WGS84) stays with the crate.

use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};

/// Bessel 1841 and the Bern origin, from swisstopo.
const A: f64 = 6_377_397.155;
const E2: f64 = 0.006_674_372_230_614;
const PHI0_DEG: f64 = 46.952_405_555_555_56;
const LAMBDA0_DEG: f64 = 7.439_583_333_333_333;

/// One Swiss grid: LV95 or LV03 differ only by their false origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SwissGrid {
    pub false_easting: f64,
    pub false_northing: f64,
}

impl SwissGrid {
    pub const LV95: SwissGrid = SwissGrid {
        false_easting: 2_600_000.0,
        false_northing: 1_200_000.0,
    };
    pub const LV03: SwissGrid = SwissGrid {
        false_easting: 600_000.0,
        false_northing: 200_000.0,
    };

    /// Geodetic (lon, lat) in degrees on Bessel 1841 to grid (E, N) in metres.
    pub fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let c = Constants::get();
        let phi = lat.to_radians();
        let lambda = lon.to_radians();
        let e = E2.sqrt();
        let s = c.alpha * (FRAC_PI_4 + phi / 2.0).tan().ln()
            - c.alpha * e / 2.0 * ((1.0 + e * phi.sin()) / (1.0 - e * phi.sin())).ln()
            + c.k;
        let b = 2.0 * (s.exp().atan() - FRAC_PI_4);
        let l = c.alpha * (lambda - LAMBDA0_DEG.to_radians());
        let l_bar = (l.sin() / (c.b0.sin() * b.tan() + c.b0.cos() * l.cos())).atan();
        let b_bar = (c.b0.cos() * b.sin() - c.b0.sin() * b.cos() * l.cos()).asin();
        let y = c.r * l_bar;
        let x = c.r / 2.0 * ((1.0 + b_bar.sin()) / (1.0 - b_bar.sin())).ln();
        (y + self.false_easting, x + self.false_northing)
    }

    /// Grid (E, N) in metres to geodetic (lon, lat) in degrees on Bessel 1841.
    pub fn inverse(&self, easting: f64, northing: f64) -> (f64, f64) {
        let c = Constants::get();
        let y = easting - self.false_easting;
        let x = northing - self.false_northing;
        let l_bar = y / c.r;
        let b_bar = 2.0 * ((x / c.r).exp().atan() - FRAC_PI_4);
        let b = (c.b0.cos() * b_bar.sin() + c.b0.sin() * b_bar.cos() * l_bar.cos()).asin();
        let l = (l_bar.sin() / (c.b0.cos() * l_bar.cos() - c.b0.sin() * b_bar.tan())).atan();
        let lambda = LAMBDA0_DEG.to_radians() + l / c.alpha;
        let e = E2.sqrt();
        let base = ((FRAC_PI_4 + b / 2.0).tan().ln() - c.k) / c.alpha;
        let mut phi = 2.0 * base.exp().atan() - FRAC_PI_2;
        for _ in 0..12 {
            let next = 2.0
                * (base + e * (FRAC_PI_4 + (e * phi.sin()).asin() / 2.0).tan().ln())
                    .exp()
                    .atan()
                - FRAC_PI_2;
            if (next - phi).abs() < 1e-14 {
                phi = next;
                break;
            }
            phi = next;
        }
        (lambda.to_degrees(), phi.to_degrees())
    }
}

/// Projection constants derived once from the ellipsoid and origin.
struct Constants {
    r: f64,
    alpha: f64,
    b0: f64,
    k: f64,
}

impl Constants {
    fn get() -> &'static Constants {
        static CONSTANTS: std::sync::OnceLock<Constants> = std::sync::OnceLock::new();
        CONSTANTS.get_or_init(|| {
            let phi0 = PHI0_DEG.to_radians();
            let e = E2.sqrt();
            let r = A * (1.0 - E2).sqrt() / (1.0 - E2 * phi0.sin().powi(2));
            let alpha = (1.0 + E2 * phi0.cos().powi(4) / (1.0 - E2)).sqrt();
            let b0 = (phi0.sin() / alpha).asin();
            let k = (FRAC_PI_4 + b0 / 2.0).tan().ln() - alpha * (FRAC_PI_4 + phi0 / 2.0).tan().ln()
                + alpha * e / 2.0 * ((1.0 + e * phi0.sin()) / (1.0 - e * phi0.sin())).ln();
            Constants { r, alpha, b0, k }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// swisstopo's published constants.
    #[test]
    fn the_derived_constants_are_swisstopos() {
        let c = Constants::get();
        assert!((c.r - 6_378_815.903_65).abs() < 1e-4, "{}", c.r);
        assert!(
            (c.alpha - 1.000_729_138_430_38).abs() < 1e-12,
            "{}",
            c.alpha
        );
        // b0 = 46° 54' 27.83324"
        assert!(
            (c.b0.to_degrees() - (46.0 + 54.0 / 60.0 + 27.833_24 / 3600.0)).abs() < 1e-8,
            "{}",
            c.b0.to_degrees()
        );
        assert!((c.k - 0.003_066_732_377_275_1).abs() < 1e-14, "{}", c.k);
    }

    /// swisstopo's worked example (Rigi, geodetic on Bessel) in LV95 and LV03,
    /// and the round trip.
    #[test]
    fn rigi_projects_to_the_published_grid_values() {
        let lon = 8.0 + 29.0 / 60.0 + 11.111_27 / 3600.0;
        let lat = 47.0 + 3.0 / 60.0 + 28.956_59 / 3600.0;
        let (e, n) = SwissGrid::LV95.forward(lon, lat);
        assert!((e - 2_679_520.05).abs() < 0.01, "{e}");
        assert!((n - 1_212_273.44).abs() < 0.01, "{n}");
        let (e03, n03) = SwissGrid::LV03.forward(lon, lat);
        assert!((e03 - 679_520.05).abs() < 0.01 && (n03 - 212_273.44).abs() < 0.01);
        let (back_lon, back_lat) = SwissGrid::LV95.inverse(e, n);
        assert!((back_lon - lon).abs() < 1e-10 && (back_lat - lat).abs() < 1e-10);
    }
}
