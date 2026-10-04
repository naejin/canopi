//! Ellipsoidal Lambert Azimuthal Equal-Area, oblique aspect (EPSG method
//! 9820), behind ETRS89-extended / LAEA Europe (EPSG:3035) and any
//! user-defined LAEA.
//!
//! `wbprojection` 0.3.3 projects LAEA on the sphere, which lands 0.8 km to
//! 5 km from PROJ across Europe, so the engine carries Snyder's ellipsoidal
//! formulas (Map Projections: A Working Manual, pp. 187–190): authalic
//! latitude, then the oblique azimuthal equal-area mapping. The datum step
//! stays with the crate.

/// One oblique LAEA: origin and false origin in degrees and metres on an
/// ellipsoid given by its semi-major axis and eccentricity squared.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Laea {
    pub lon0: f64,
    pub lat0: f64,
    pub false_easting: f64,
    pub false_northing: f64,
    pub a: f64,
    pub e2: f64,
}

impl Laea {
    fn e(&self) -> f64 {
        self.e2.sqrt()
    }

    /// Snyder's `q` (14-15) for a geodetic latitude in radians.
    fn q(&self, phi: f64) -> f64 {
        let e = self.e();
        let s = phi.sin();
        if e == 0.0 {
            return 2.0 * s;
        }
        (1.0 - self.e2)
            * (s / (1.0 - self.e2 * s * s)
                - (1.0 / (2.0 * e)) * ((1.0 - e * s) / (1.0 + e * s)).ln())
    }

    /// Constants of the aspect: `(q_p, beta1, R_q, D)`.
    fn constants(&self) -> (f64, f64, f64, f64) {
        let phi1 = self.lat0.to_radians();
        let q_p = self.q(std::f64::consts::FRAC_PI_2);
        let q1 = self.q(phi1);
        let beta1 = (q1 / q_p).clamp(-1.0, 1.0).asin();
        let r_q = self.a * (q_p / 2.0).sqrt();
        let m1 = phi1.cos() / (1.0 - self.e2 * phi1.sin().powi(2)).sqrt();
        let d = self.a * m1 / (r_q * beta1.cos());
        (q_p, beta1, r_q, d)
    }

    /// Geodetic (lon, lat) in degrees to (E, N) in metres.
    pub fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let (q_p, beta1, r_q, d) = self.constants();
        let phi = lat.to_radians();
        let dlam = (lon - self.lon0).to_radians();
        let beta = (self.q(phi) / q_p).clamp(-1.0, 1.0).asin();
        let b = r_q
            * (2.0 / (1.0 + beta1.sin() * beta.sin() + beta1.cos() * beta.cos() * dlam.cos()))
                .sqrt();
        let x = b * d * beta.cos() * dlam.sin();
        let y = (b / d) * (beta1.cos() * beta.sin() - beta1.sin() * beta.cos() * dlam.cos());
        (x + self.false_easting, y + self.false_northing)
    }

    /// (E, N) in metres to geodetic (lon, lat) in degrees.
    pub fn inverse(&self, easting: f64, northing: f64) -> (f64, f64) {
        let (q_p, beta1, r_q, d) = self.constants();
        let x = easting - self.false_easting;
        let y = northing - self.false_northing;
        let rho = ((x / d).powi(2) + (d * y).powi(2)).sqrt();
        if rho == 0.0 {
            return (self.lon0, self.lat0);
        }
        let c_e = 2.0 * (rho / (2.0 * r_q)).clamp(-1.0, 1.0).asin();
        let q = q_p * (c_e.cos() * beta1.sin() + d * y * c_e.sin() * beta1.cos() / rho);
        let lambda = self.lon0.to_radians()
            + (x * c_e.sin())
                .atan2(d * rho * beta1.cos() * c_e.cos() - d * d * y * beta1.sin() * c_e.sin());
        // Geodetic latitude from q by Snyder's iteration (3-16).
        let e = self.e();
        let mut phi = (q / 2.0).clamp(-1.0, 1.0).asin();
        if e > 0.0 {
            for _ in 0..30 {
                let s = phi.sin();
                let denominator = 1.0 - self.e2 * s * s;
                let next = phi
                    + denominator.powi(2) / (2.0 * phi.cos())
                        * (q / (1.0 - self.e2) - s / denominator
                            + (1.0 / (2.0 * e)) * ((1.0 - e * s) / (1.0 + e * s)).ln());
                if (next - phi).abs() < 1e-14 {
                    phi = next;
                    break;
                }
                phi = next;
            }
        }
        (lambda.to_degrees(), phi.to_degrees())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn europe() -> Laea {
        // ETRS89-extended / LAEA Europe on GRS 1980.
        Laea {
            lon0: 10.0,
            lat0: 52.0,
            false_easting: 4_321_000.0,
            false_northing: 3_210_000.0,
            a: 6_378_137.0,
            e2: 0.006_694_380_022_900_787,
        }
    }

    /// GDAL's EPSG:3035 coordinates of points across Europe, to the millimetre.
    #[test]
    fn europe_laea_matches_proj_and_round_trips() {
        let laea = europe();
        let cases = [
            ((10.0, 52.0), (4_321_000.0, 3_210_000.0)),
            ((10.0, 45.0), (4_321_000.0, 2_432_032.970_09)),
            ((10.0, 60.0), (4_321_000.0, 4_099_937.926_24)),
            ((0.0, 52.0), (3_636_709.969_87, 3_257_056.055_40)),
            ((20.0, 52.0), (5_005_290.030_13, 3_257_056.055_40)),
            ((2.35, 48.85), (3_760_536.822_90, 2_888_771.020_95)),
            ((-3.7, 40.4), (3_159_401.696_63, 2_027_957.632_41)),
            ((30.0, 60.0), (5_422_492.774_96, 4_256_803.184_50)),
            ((37.6, 55.75), (6_005_703.357_32, 3_956_749.690_36)),
        ];
        for ((lon, lat), (e, n)) in cases {
            let (x, y) = laea.forward(lon, lat);
            assert!(
                (x - e).abs() < 1e-3 && (y - n).abs() < 1e-3,
                "{lon} {lat}: {x} {y}"
            );
            let (back_lon, back_lat) = laea.inverse(x, y);
            assert!(
                (back_lon - lon).abs() < 1e-10 && (back_lat - lat).abs() < 1e-10,
                "{lon} {lat}: {back_lon} {back_lat}"
            );
        }
    }
}
