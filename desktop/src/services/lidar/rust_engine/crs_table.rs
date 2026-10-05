//! The coordinate reference systems Canopi places LiDAR in (U31).
//!
//! One row per EPSG code: its PROJ definition in the form the CRS authority
//! (`crs.rs`) reads correctly, with the Helmert shift to WGS84 written out,
//! no `+pm` (the Paris meridian is folded into `+lon_0`), `+k` for the scale
//! factor and no datum on Web Mercator. A row's area bounds its reference
//! points (`crs_reference_points.rs`, written by
//! `scripts/gen_crs_reference_points.sh` from PROJ's `cs2cs`). The authority
//! matches PROJ within 1 cm for the row's own shift, and its stated accuracy
//! is how far PROJ's own choice of operation may sit from the row: 1 cm, and
//! 3 m for Krovak (5514), whose row takes PROJ's Czech shift (EPSG:1623)
//! where PROJ takes its Slovak one in Slovakia; U31 allows 10 m. Every other
//! code is refused by name. Adding a code is one row here plus a run of the
//! script.
//!
//! The definitions are derived from the EPSG Geodetic Parameter Dataset
//! (IOGP), see `THIRD_PARTY_NOTICES.md`.

/// Whether a row's coordinates are ground metres, projected metres that are
/// not ground metres, or geographic degrees.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CrsKind {
    ProjectedMetre,
    /// Mercator (Web Mercator): its metres grow as 1/cos(latitude), about
    /// 1.5 ground metres at 48N, so distances and slopes on it are wrong.
    ProjectedOther,
    Geographic,
}

/// One supported coordinate reference system.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CrsRow {
    pub code: u32,
    pub name: &'static str,
    pub proj: &'static str,
    /// West, south, east, north in degrees: the EPSG area of use's bounding
    /// box, but for Krovak a band across Czechia and Slovakia, because its
    /// box's corners lie in Austria and Poland, where PROJ has only its 6 m
    /// shift.
    pub area: [f64; 4],
    /// Metres between this row and PROJ's own choice of operation.
    pub accuracy_m: f64,
}

impl CrsRow {
    pub(crate) fn kind(&self) -> CrsKind {
        if self.proj.starts_with("+proj=longlat") {
            CrsKind::Geographic
        } else if self.proj.starts_with("+proj=merc") {
            CrsKind::ProjectedOther
        } else {
            CrsKind::ProjectedMetre
        }
    }
}

const fn row(
    code: u32,
    name: &'static str,
    proj: &'static str,
    area: [f64; 4],
    accuracy_m: f64,
) -> CrsRow {
    CrsRow {
        code,
        name,
        proj,
        area,
        accuracy_m,
    }
}

/// Codes read as another row: a compound CRS by its horizontal part.
pub(crate) const ALIASES: &[(u32, u32)] = &[
    // Amersfoort / RD New + NAP height, the code of every AHN LAZ.
    (7415, 28992),
    // RGF93 v1 / Lambert-93 + NGF-IGN69 and + NGF-IGN78 height.
    (5698, 2154),
    (5699, 2154),
];

/// The supported systems as the refusal names them; a test keeps it in step
/// with the rows.
pub(crate) const SUPPORTED_SUMMARY: &str = "Lambert-93 (EPSG:2154), CC 42 to 50 (EPSG:3942 to 3950), NTF Lambert II (EPSG:27572), the French overseas UTM grids (EPSG:2972, 2975, 4471, 4559, 5490), RD New (EPSG:28992), Belgian Lambert 72 and 2008 (EPSG:31370, 3812), Luxembourg TM (EPSG:2169), Swiss LV95 and LV03 (EPSG:2056, 21781), British National Grid (EPSG:27700), Austria Lambert (EPSG:31287), Greek Grid (EPSG:2100), S-JTSK Krovak (EPSG:5514), LAEA Europe (EPSG:3035), WGS 84 and ETRS89 UTM zones (EPSG:32601 to 32660, 32701 to 32760, 25828 to 25838), Web Mercator (EPSG:3857) and WGS 84, ETRS89 and RGF93 longitude and latitude (EPSG:4326, 4258, 4171)";

#[rustfmt::skip]
pub(crate) const ROWS: &[CrsRow] = &[
    row(2154, "RGF93 v1 / Lambert-93", "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-9.86, 41.15, 10.38, 51.56], 0.01),
    row(3942, "RGF93 v1 / CC42", "+proj=lcc +lat_0=42 +lon_0=3 +lat_1=41.25 +lat_2=42.75 +x_0=1700000 +y_0=1200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-1.06, 41.31, 9.63, 43.07], 0.01),
    row(3943, "RGF93 v1 / CC43", "+proj=lcc +lat_0=43 +lon_0=3 +lat_1=42.25 +lat_2=43.75 +x_0=1700000 +y_0=2200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-1.79, 42.33, 7.65, 44.01], 0.01),
    row(3944, "RGF93 v1 / CC44", "+proj=lcc +lat_0=44 +lon_0=3 +lat_1=43.25 +lat_2=44.75 +x_0=1700000 +y_0=3200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-1.79, 42.92, 7.71, 45.0], 0.01),
    row(3945, "RGF93 v1 / CC45", "+proj=lcc +lat_0=45 +lon_0=3 +lat_1=44.25 +lat_2=45.75 +x_0=1700000 +y_0=4200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-1.46, 44.0, 7.71, 46.0], 0.01),
    row(3946, "RGF93 v1 / CC46", "+proj=lcc +lat_0=46 +lon_0=3 +lat_1=45.25 +lat_2=46.75 +x_0=1700000 +y_0=5200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-2.21, 45.0, 7.16, 47.0], 0.01),
    row(3947, "RGF93 v1 / CC47", "+proj=lcc +lat_0=47 +lon_0=3 +lat_1=46.25 +lat_2=47.75 +x_0=1700000 +y_0=6200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-4.77, 46.0, 7.63, 48.0], 0.01),
    row(3948, "RGF93 v1 / CC48", "+proj=lcc +lat_0=48 +lon_0=3 +lat_1=47.25 +lat_2=48.75 +x_0=1700000 +y_0=7200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-4.87, 47.0, 8.23, 49.0], 0.01),
    row(3949, "RGF93 v1 / CC49", "+proj=lcc +lat_0=49 +lon_0=3 +lat_1=48.25 +lat_2=49.75 +x_0=1700000 +y_0=8200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-4.87, 48.0, 8.23, 50.0], 0.01),
    row(3950, "RGF93 v1 / CC50", "+proj=lcc +lat_0=50 +lon_0=3 +lat_1=49.25 +lat_2=50.75 +x_0=1700000 +y_0=9200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-2.03, 49.0, 8.08, 51.14], 0.01),
    row(27572, "NTF (Paris) / Lambert zone II", "+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=2.337229166666667 +k=0.99987742 +x_0=600000 +y_0=2200000 +ellps=clrk80ign +towgs84=-168,-60,320,0,0,0,0 +units=m +no_defs", [-4.87, 42.33, 8.23, 51.14], 0.01),
    row(2972, "RGFG95 / UTM zone 22N", "+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-54.0, 2.17, -49.45, 8.88], 0.01),
    row(2975, "RGR92 / UTM zone 40S", "+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [54.0, -24.72, 58.24, -18.28], 0.01),
    row(5490, "RGAF09 / UTM zone 20N", "+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-63.66, 14.08, -60.0, 18.31], 0.01),
    row(4471, "RGM04 / UTM zone 38S", "+proj=utm +zone=38 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [43.68, -14.49, 46.7, -11.33], 0.01),
    row(4559, "RRAF 1991 / UTM zone 20N", "+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-63.66, 14.08, -60.0, 18.31], 0.01),
    row(28992, "Amersfoort / RD New", "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.2369,50.0087,465.658,-0.406857,0.350733,-1.87035,4.0812 +units=m +no_defs", [3.2, 50.75, 7.22, 53.7], 0.01),
    row(31370, "BD72 / Belgian Lambert 72", "+proj=lcc +lat_0=90 +lon_0=4.367486666666666 +lat_1=51.16666723333333 +lat_2=49.8333339 +x_0=150000.01256 +y_0=5400088.4378 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs", [2.5, 49.5, 6.4, 51.51], 0.01),
    row(3812, "ETRS89 / Belgian Lambert 2008", "+proj=lcc +lat_0=50.797815 +lon_0=4.35921583333333 +lat_1=49.8333333333333 +lat_2=51.1666666666667 +x_0=649328 +y_0=665262 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [2.5, 49.5, 6.4, 51.51], 0.01),
    row(2169, "LUREF / Luxembourg TM", "+proj=tmerc +lat_0=49.8333333333333 +lon_0=6.16666666666667 +k=1 +x_0=80000 +y_0=100000 +ellps=intl +towgs84=-189.6806,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598 +units=m +no_defs", [5.73, 49.44, 6.53, 50.19], 0.01),
    row(2056, "CH1903+ / LV95", "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs", [5.96, 45.82, 10.49, 47.81], 0.01),
    row(21781, "CH1903 / LV03", "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k=1 +x_0=600000 +y_0=200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs", [5.96, 45.82, 10.49, 47.81], 0.01),
    row(27700, "OSGB36 / British National Grid", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs", [-9.01, 49.75, 2.01, 61.01], 0.01),
    row(31287, "MGI / Austria Lambert", "+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs", [9.53, 46.4, 17.17, 49.02], 0.01),
    row(2100, "GGRS87 / Greek Grid", "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs", [19.57, 34.88, 28.3, 41.75], 0.01),
    row(5514, "S-JTSK / Krovak East North", "+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs", [12.8, 48.9, 22.0, 49.4], 3.0),
    row(3035, "ETRS89-extended / LAEA Europe", "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-35.58, 24.6, 44.83, 84.73], 0.01),
    row(3857, "WGS 84 / Pseudo-Mercator", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs", [-180.0, -85.0, 180.0, 85.0], 0.01),
    row(4326, "WGS 84", "+proj=longlat +datum=WGS84 +no_defs", [-180.0, -90.0, 180.0, 90.0], 0.01),
    row(4258, "ETRS89", "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs", [-16.1, 32.88, 40.18, 84.73], 0.01),
    row(4171, "RGF93 v1", "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs", [-9.86, 41.15, 10.38, 51.56], 0.01),
    row(25828, "ETRS89 / UTM zone 28N", "+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-16.1, 34.93, -11.99, 72.44], 0.01),
    row(25829, "ETRS89 / UTM zone 29N", "+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-12.0, 34.91, -6.0, 74.13], 0.01),
    row(25830, "ETRS89 / UTM zone 30N", "+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [-6.0, 35.26, 0.01, 80.49], 0.01),
    row(25831, "ETRS89 / UTM zone 31N", "+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [0.0, 37.0, 6.01, 82.45], 0.01),
    row(25832, "ETRS89 / UTM zone 32N", "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [6.0, 38.76, 12.01, 84.33], 0.01),
    row(25833, "ETRS89 / UTM zone 33N", "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [12.0, 46.4, 18.01, 84.42], 0.01),
    row(25834, "ETRS89 / UTM zone 34N", "+proj=utm +zone=34 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [17.99, 58.84, 24.01, 84.54], 0.01),
    row(25835, "ETRS89 / UTM zone 35N", "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [24.0, 59.64, 30.01, 84.73], 0.01),
    row(25836, "ETRS89 / UTM zone 36N", "+proj=utm +zone=36 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [30.0, 61.73, 36.01, 84.7], 0.01),
    row(25837, "ETRS89 / UTM zone 37N", "+proj=utm +zone=37 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [36.0, 72.99, 38.01, 79.07], 0.01),
    row(25838, "ETRS89 / UTM zone 38N", "+proj=utm +zone=38 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", [42.0, 37.0, 48.0, 41.65], 0.01),
    row(32601, "WGS 84 / UTM zone 1N", "+proj=utm +zone=1 +datum=WGS84 +units=m +no_defs", [-180.0, 0.0, -174.0, 84.0], 0.01),
    row(32602, "WGS 84 / UTM zone 2N", "+proj=utm +zone=2 +datum=WGS84 +units=m +no_defs", [-174.0, 0.0, -168.0, 84.0], 0.01),
    row(32603, "WGS 84 / UTM zone 3N", "+proj=utm +zone=3 +datum=WGS84 +units=m +no_defs", [-168.0, 0.0, -162.0, 84.0], 0.01),
    row(32604, "WGS 84 / UTM zone 4N", "+proj=utm +zone=4 +datum=WGS84 +units=m +no_defs", [-162.0, 0.0, -156.0, 84.0], 0.01),
    row(32605, "WGS 84 / UTM zone 5N", "+proj=utm +zone=5 +datum=WGS84 +units=m +no_defs", [-156.0, 0.0, -150.0, 84.0], 0.01),
    row(32606, "WGS 84 / UTM zone 6N", "+proj=utm +zone=6 +datum=WGS84 +units=m +no_defs", [-150.0, 0.0, -144.0, 84.0], 0.01),
    row(32607, "WGS 84 / UTM zone 7N", "+proj=utm +zone=7 +datum=WGS84 +units=m +no_defs", [-144.0, 0.0, -138.0, 84.0], 0.01),
    row(32608, "WGS 84 / UTM zone 8N", "+proj=utm +zone=8 +datum=WGS84 +units=m +no_defs", [-138.0, 0.0, -132.0, 84.0], 0.01),
    row(32609, "WGS 84 / UTM zone 9N", "+proj=utm +zone=9 +datum=WGS84 +units=m +no_defs", [-132.0, 0.0, -126.0, 84.0], 0.01),
    row(32610, "WGS 84 / UTM zone 10N", "+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs", [-126.0, 0.0, -120.0, 84.0], 0.01),
    row(32611, "WGS 84 / UTM zone 11N", "+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs", [-120.0, 0.0, -114.0, 84.0], 0.01),
    row(32612, "WGS 84 / UTM zone 12N", "+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs", [-114.0, 0.0, -108.0, 84.0], 0.01),
    row(32613, "WGS 84 / UTM zone 13N", "+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs", [-108.0, 0.0, -102.0, 84.0], 0.01),
    row(32614, "WGS 84 / UTM zone 14N", "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs", [-102.0, 0.0, -96.0, 84.0], 0.01),
    row(32615, "WGS 84 / UTM zone 15N", "+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs", [-96.0, 0.0, -90.0, 84.0], 0.01),
    row(32616, "WGS 84 / UTM zone 16N", "+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs", [-90.0, 0.0, -84.0, 84.0], 0.01),
    row(32617, "WGS 84 / UTM zone 17N", "+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs", [-84.0, 0.0, -78.0, 84.0], 0.01),
    row(32618, "WGS 84 / UTM zone 18N", "+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs", [-78.0, 0.0, -72.0, 84.0], 0.01),
    row(32619, "WGS 84 / UTM zone 19N", "+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs", [-72.0, 0.0, -66.0, 84.0], 0.01),
    row(32620, "WGS 84 / UTM zone 20N", "+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs", [-66.0, 0.0, -60.0, 84.0], 0.01),
    row(32621, "WGS 84 / UTM zone 21N", "+proj=utm +zone=21 +datum=WGS84 +units=m +no_defs", [-60.0, 0.0, -54.0, 84.0], 0.01),
    row(32622, "WGS 84 / UTM zone 22N", "+proj=utm +zone=22 +datum=WGS84 +units=m +no_defs", [-54.0, 0.0, -48.0, 84.0], 0.01),
    row(32623, "WGS 84 / UTM zone 23N", "+proj=utm +zone=23 +datum=WGS84 +units=m +no_defs", [-48.0, 0.0, -42.0, 84.0], 0.01),
    row(32624, "WGS 84 / UTM zone 24N", "+proj=utm +zone=24 +datum=WGS84 +units=m +no_defs", [-42.0, 0.0, -36.0, 84.0], 0.01),
    row(32625, "WGS 84 / UTM zone 25N", "+proj=utm +zone=25 +datum=WGS84 +units=m +no_defs", [-36.0, 0.0, -30.0, 84.0], 0.01),
    row(32626, "WGS 84 / UTM zone 26N", "+proj=utm +zone=26 +datum=WGS84 +units=m +no_defs", [-30.0, 0.0, -24.0, 84.0], 0.01),
    row(32627, "WGS 84 / UTM zone 27N", "+proj=utm +zone=27 +datum=WGS84 +units=m +no_defs", [-24.0, 0.0, -18.0, 84.0], 0.01),
    row(32628, "WGS 84 / UTM zone 28N", "+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs", [-18.0, 0.0, -12.0, 84.0], 0.01),
    row(32629, "WGS 84 / UTM zone 29N", "+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs", [-12.01, 0.0, -6.0, 84.01], 0.01),
    row(32630, "WGS 84 / UTM zone 30N", "+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs", [-6.0, 0.0, 0.0, 84.0], 0.01),
    row(32631, "WGS 84 / UTM zone 31N", "+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs", [0.0, 0.0, 6.0, 84.0], 0.01),
    row(32632, "WGS 84 / UTM zone 32N", "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs", [6.0, 0.0, 12.0, 84.0], 0.01),
    row(32633, "WGS 84 / UTM zone 33N", "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs", [12.0, 0.0, 18.0, 84.0], 0.01),
    row(32634, "WGS 84 / UTM zone 34N", "+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs", [18.0, 0.0, 24.0, 84.0], 0.01),
    row(32635, "WGS 84 / UTM zone 35N", "+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs", [24.0, 0.0, 30.0, 84.0], 0.01),
    row(32636, "WGS 84 / UTM zone 36N", "+proj=utm +zone=36 +datum=WGS84 +units=m +no_defs", [30.0, 0.0, 36.0, 84.0], 0.01),
    row(32637, "WGS 84 / UTM zone 37N", "+proj=utm +zone=37 +datum=WGS84 +units=m +no_defs", [36.0, 0.0, 42.0, 84.0], 0.01),
    row(32638, "WGS 84 / UTM zone 38N", "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs", [42.0, 0.0, 48.0, 84.0], 0.01),
    row(32639, "WGS 84 / UTM zone 39N", "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs", [48.0, 0.0, 54.0, 84.0], 0.01),
    row(32640, "WGS 84 / UTM zone 40N", "+proj=utm +zone=40 +datum=WGS84 +units=m +no_defs", [54.0, 0.0, 60.0, 84.0], 0.01),
    row(32641, "WGS 84 / UTM zone 41N", "+proj=utm +zone=41 +datum=WGS84 +units=m +no_defs", [60.0, 0.0, 66.0, 84.0], 0.01),
    row(32642, "WGS 84 / UTM zone 42N", "+proj=utm +zone=42 +datum=WGS84 +units=m +no_defs", [66.0, 0.0, 72.0, 84.0], 0.01),
    row(32643, "WGS 84 / UTM zone 43N", "+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs", [72.0, 0.0, 78.0, 84.0], 0.01),
    row(32644, "WGS 84 / UTM zone 44N", "+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs", [78.0, 0.0, 84.0, 84.0], 0.01),
    row(32645, "WGS 84 / UTM zone 45N", "+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs", [84.0, 0.0, 90.0, 84.0], 0.01),
    row(32646, "WGS 84 / UTM zone 46N", "+proj=utm +zone=46 +datum=WGS84 +units=m +no_defs", [90.0, 0.0, 96.0, 84.0], 0.01),
    row(32647, "WGS 84 / UTM zone 47N", "+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs", [96.0, 0.0, 102.0, 84.0], 0.01),
    row(32648, "WGS 84 / UTM zone 48N", "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs", [102.0, 0.0, 108.0, 84.0], 0.01),
    row(32649, "WGS 84 / UTM zone 49N", "+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs", [108.0, 0.0, 114.0, 84.0], 0.01),
    row(32650, "WGS 84 / UTM zone 50N", "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs", [114.0, 0.0, 120.0, 84.0], 0.01),
    row(32651, "WGS 84 / UTM zone 51N", "+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs", [120.0, 0.0, 126.0, 84.0], 0.01),
    row(32652, "WGS 84 / UTM zone 52N", "+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs", [126.0, 0.0, 132.0, 84.0], 0.01),
    row(32653, "WGS 84 / UTM zone 53N", "+proj=utm +zone=53 +datum=WGS84 +units=m +no_defs", [132.0, 0.0, 138.0, 84.0], 0.01),
    row(32654, "WGS 84 / UTM zone 54N", "+proj=utm +zone=54 +datum=WGS84 +units=m +no_defs", [138.0, 0.0, 144.0, 84.0], 0.01),
    row(32655, "WGS 84 / UTM zone 55N", "+proj=utm +zone=55 +datum=WGS84 +units=m +no_defs", [144.0, 0.0, 150.0, 84.0], 0.01),
    row(32656, "WGS 84 / UTM zone 56N", "+proj=utm +zone=56 +datum=WGS84 +units=m +no_defs", [150.0, 0.0, 156.0, 84.0], 0.01),
    row(32657, "WGS 84 / UTM zone 57N", "+proj=utm +zone=57 +datum=WGS84 +units=m +no_defs", [156.0, 0.0, 162.0, 84.0], 0.01),
    row(32658, "WGS 84 / UTM zone 58N", "+proj=utm +zone=58 +datum=WGS84 +units=m +no_defs", [162.0, 0.0, 168.0, 84.0], 0.01),
    row(32659, "WGS 84 / UTM zone 59N", "+proj=utm +zone=59 +datum=WGS84 +units=m +no_defs", [168.0, 0.0, 174.0, 84.0], 0.01),
    row(32660, "WGS 84 / UTM zone 60N", "+proj=utm +zone=60 +datum=WGS84 +units=m +no_defs", [174.0, 0.0, 180.0, 84.0], 0.01),
    row(32701, "WGS 84 / UTM zone 1S", "+proj=utm +zone=1 +south +datum=WGS84 +units=m +no_defs", [-180.0, -80.0, -174.0, 0.0], 0.01),
    row(32702, "WGS 84 / UTM zone 2S", "+proj=utm +zone=2 +south +datum=WGS84 +units=m +no_defs", [-174.0, -80.0, -168.0, 0.0], 0.01),
    row(32703, "WGS 84 / UTM zone 3S", "+proj=utm +zone=3 +south +datum=WGS84 +units=m +no_defs", [-168.0, -80.0, -162.0, 0.0], 0.01),
    row(32704, "WGS 84 / UTM zone 4S", "+proj=utm +zone=4 +south +datum=WGS84 +units=m +no_defs", [-162.0, -80.0, -156.0, 0.0], 0.01),
    row(32705, "WGS 84 / UTM zone 5S", "+proj=utm +zone=5 +south +datum=WGS84 +units=m +no_defs", [-156.0, -80.0, -150.0, 0.0], 0.01),
    row(32706, "WGS 84 / UTM zone 6S", "+proj=utm +zone=6 +south +datum=WGS84 +units=m +no_defs", [-150.0, -80.0, -144.0, 0.0], 0.01),
    row(32707, "WGS 84 / UTM zone 7S", "+proj=utm +zone=7 +south +datum=WGS84 +units=m +no_defs", [-144.0, -80.0, -138.0, 0.0], 0.01),
    row(32708, "WGS 84 / UTM zone 8S", "+proj=utm +zone=8 +south +datum=WGS84 +units=m +no_defs", [-138.0, -80.0, -132.0, 0.0], 0.01),
    row(32709, "WGS 84 / UTM zone 9S", "+proj=utm +zone=9 +south +datum=WGS84 +units=m +no_defs", [-132.0, -80.0, -126.0, 0.0], 0.01),
    row(32710, "WGS 84 / UTM zone 10S", "+proj=utm +zone=10 +south +datum=WGS84 +units=m +no_defs", [-126.0, -80.0, -120.0, 0.0], 0.01),
    row(32711, "WGS 84 / UTM zone 11S", "+proj=utm +zone=11 +south +datum=WGS84 +units=m +no_defs", [-120.0, -80.0, -114.0, 0.0], 0.01),
    row(32712, "WGS 84 / UTM zone 12S", "+proj=utm +zone=12 +south +datum=WGS84 +units=m +no_defs", [-114.0, -80.0, -108.0, 0.0], 0.01),
    row(32713, "WGS 84 / UTM zone 13S", "+proj=utm +zone=13 +south +datum=WGS84 +units=m +no_defs", [-108.0, -80.0, -102.0, 0.0], 0.01),
    row(32714, "WGS 84 / UTM zone 14S", "+proj=utm +zone=14 +south +datum=WGS84 +units=m +no_defs", [-102.0, -80.0, -96.0, 0.0], 0.01),
    row(32715, "WGS 84 / UTM zone 15S", "+proj=utm +zone=15 +south +datum=WGS84 +units=m +no_defs", [-96.0, -80.0, -90.0, 0.0], 0.01),
    row(32716, "WGS 84 / UTM zone 16S", "+proj=utm +zone=16 +south +datum=WGS84 +units=m +no_defs", [-90.0, -80.0, -84.0, 0.0], 0.01),
    row(32717, "WGS 84 / UTM zone 17S", "+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs", [-84.0, -80.0, -78.0, 0.0], 0.01),
    row(32718, "WGS 84 / UTM zone 18S", "+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs", [-78.0, -80.0, -72.0, 0.0], 0.01),
    row(32719, "WGS 84 / UTM zone 19S", "+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs", [-72.0, -80.0, -66.0, 0.0], 0.01),
    row(32720, "WGS 84 / UTM zone 20S", "+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs", [-66.0, -80.0, -60.0, 0.0], 0.01),
    row(32721, "WGS 84 / UTM zone 21S", "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs", [-60.0, -80.0, -54.0, 0.0], 0.01),
    row(32722, "WGS 84 / UTM zone 22S", "+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs", [-54.0, -80.0, -48.0, 0.0], 0.01),
    row(32723, "WGS 84 / UTM zone 23S", "+proj=utm +zone=23 +south +datum=WGS84 +units=m +no_defs", [-48.0, -80.0, -42.0, 0.0], 0.01),
    row(32724, "WGS 84 / UTM zone 24S", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs", [-42.0, -80.0, -36.0, 0.0], 0.01),
    row(32725, "WGS 84 / UTM zone 25S", "+proj=utm +zone=25 +south +datum=WGS84 +units=m +no_defs", [-36.0, -80.0, -30.0, 0.0], 0.01),
    row(32726, "WGS 84 / UTM zone 26S", "+proj=utm +zone=26 +south +datum=WGS84 +units=m +no_defs", [-30.0, -80.0, -24.0, 0.0], 0.01),
    row(32727, "WGS 84 / UTM zone 27S", "+proj=utm +zone=27 +south +datum=WGS84 +units=m +no_defs", [-24.0, -80.0, -18.0, 0.0], 0.01),
    row(32728, "WGS 84 / UTM zone 28S", "+proj=utm +zone=28 +south +datum=WGS84 +units=m +no_defs", [-18.0, -80.0, -12.0, 0.0], 0.01),
    row(32729, "WGS 84 / UTM zone 29S", "+proj=utm +zone=29 +south +datum=WGS84 +units=m +no_defs", [-12.0, -80.0, -6.0, 0.0], 0.01),
    row(32730, "WGS 84 / UTM zone 30S", "+proj=utm +zone=30 +south +datum=WGS84 +units=m +no_defs", [-6.0, -80.0, 0.0, 0.0], 0.01),
    row(32731, "WGS 84 / UTM zone 31S", "+proj=utm +zone=31 +south +datum=WGS84 +units=m +no_defs", [0.0, -80.0, 6.0, 0.0], 0.01),
    row(32732, "WGS 84 / UTM zone 32S", "+proj=utm +zone=32 +south +datum=WGS84 +units=m +no_defs", [6.0, -80.0, 12.0, 0.0], 0.01),
    row(32733, "WGS 84 / UTM zone 33S", "+proj=utm +zone=33 +south +datum=WGS84 +units=m +no_defs", [12.0, -80.0, 18.0, 0.0], 0.01),
    row(32734, "WGS 84 / UTM zone 34S", "+proj=utm +zone=34 +south +datum=WGS84 +units=m +no_defs", [18.0, -80.0, 24.0, 0.0], 0.01),
    row(32735, "WGS 84 / UTM zone 35S", "+proj=utm +zone=35 +south +datum=WGS84 +units=m +no_defs", [24.0, -80.0, 30.0, 0.0], 0.01),
    row(32736, "WGS 84 / UTM zone 36S", "+proj=utm +zone=36 +south +datum=WGS84 +units=m +no_defs", [30.0, -80.0, 36.0, 0.0], 0.01),
    row(32737, "WGS 84 / UTM zone 37S", "+proj=utm +zone=37 +south +datum=WGS84 +units=m +no_defs", [36.0, -80.0, 42.0, 0.0], 0.01),
    row(32738, "WGS 84 / UTM zone 38S", "+proj=utm +zone=38 +south +datum=WGS84 +units=m +no_defs", [42.0, -80.0, 48.0, 0.0], 0.01),
    row(32739, "WGS 84 / UTM zone 39S", "+proj=utm +zone=39 +south +datum=WGS84 +units=m +no_defs", [48.0, -80.0, 54.0, 0.0], 0.01),
    row(32740, "WGS 84 / UTM zone 40S", "+proj=utm +zone=40 +south +datum=WGS84 +units=m +no_defs", [54.0, -80.0, 60.0, 0.0], 0.01),
    row(32741, "WGS 84 / UTM zone 41S", "+proj=utm +zone=41 +south +datum=WGS84 +units=m +no_defs", [60.0, -80.0, 66.0, 0.0], 0.01),
    row(32742, "WGS 84 / UTM zone 42S", "+proj=utm +zone=42 +south +datum=WGS84 +units=m +no_defs", [66.0, -80.0, 72.0, 0.0], 0.01),
    row(32743, "WGS 84 / UTM zone 43S", "+proj=utm +zone=43 +south +datum=WGS84 +units=m +no_defs", [72.0, -80.0, 78.0, 0.0], 0.01),
    row(32744, "WGS 84 / UTM zone 44S", "+proj=utm +zone=44 +south +datum=WGS84 +units=m +no_defs", [78.0, -80.0, 84.0, 0.0], 0.01),
    row(32745, "WGS 84 / UTM zone 45S", "+proj=utm +zone=45 +south +datum=WGS84 +units=m +no_defs", [84.0, -80.0, 90.0, 0.0], 0.01),
    row(32746, "WGS 84 / UTM zone 46S", "+proj=utm +zone=46 +south +datum=WGS84 +units=m +no_defs", [90.0, -80.0, 96.0, 0.0], 0.01),
    row(32747, "WGS 84 / UTM zone 47S", "+proj=utm +zone=47 +south +datum=WGS84 +units=m +no_defs", [96.0, -80.0, 102.0, 0.0], 0.01),
    row(32748, "WGS 84 / UTM zone 48S", "+proj=utm +zone=48 +south +datum=WGS84 +units=m +no_defs", [102.0, -80.0, 108.0, 0.0], 0.01),
    row(32749, "WGS 84 / UTM zone 49S", "+proj=utm +zone=49 +south +datum=WGS84 +units=m +no_defs", [108.0, -80.0, 114.0, 0.0], 0.01),
    row(32750, "WGS 84 / UTM zone 50S", "+proj=utm +zone=50 +south +datum=WGS84 +units=m +no_defs", [114.0, -80.0, 120.0, 0.0], 0.01),
    row(32751, "WGS 84 / UTM zone 51S", "+proj=utm +zone=51 +south +datum=WGS84 +units=m +no_defs", [120.0, -80.0, 126.0, 0.0], 0.01),
    row(32752, "WGS 84 / UTM zone 52S", "+proj=utm +zone=52 +south +datum=WGS84 +units=m +no_defs", [126.0, -80.0, 132.0, 0.0], 0.01),
    row(32753, "WGS 84 / UTM zone 53S", "+proj=utm +zone=53 +south +datum=WGS84 +units=m +no_defs", [132.0, -80.0, 138.0, 0.0], 0.01),
    row(32754, "WGS 84 / UTM zone 54S", "+proj=utm +zone=54 +south +datum=WGS84 +units=m +no_defs", [138.0, -80.0, 144.0, 0.0], 0.01),
    row(32755, "WGS 84 / UTM zone 55S", "+proj=utm +zone=55 +south +datum=WGS84 +units=m +no_defs", [144.0, -80.0, 150.0, 0.0], 0.01),
    row(32756, "WGS 84 / UTM zone 56S", "+proj=utm +zone=56 +south +datum=WGS84 +units=m +no_defs", [150.0, -80.0, 156.0, 0.0], 0.01),
    row(32757, "WGS 84 / UTM zone 57S", "+proj=utm +zone=57 +south +datum=WGS84 +units=m +no_defs", [156.0, -80.0, 162.0, 0.0], 0.01),
    row(32758, "WGS 84 / UTM zone 58S", "+proj=utm +zone=58 +south +datum=WGS84 +units=m +no_defs", [162.0, -80.0, 168.0, 0.0], 0.01),
    row(32759, "WGS 84 / UTM zone 59S", "+proj=utm +zone=59 +south +datum=WGS84 +units=m +no_defs", [168.0, -80.0, 174.0, 0.0], 0.01),
    row(32760, "WGS 84 / UTM zone 60S", "+proj=utm +zone=60 +south +datum=WGS84 +units=m +no_defs", [174.0, -80.0, 180.0, 0.0], 0.01),
];

/// The row of `code`, through the aliases.
pub(crate) fn row_of(code: u32) -> Option<&'static CrsRow> {
    let code = ALIASES
        .iter()
        .find_map(|(alias, to)| (*alias == code).then_some(*to))
        .unwrap_or(code);
    ROWS.iter().find(|row| row.code == code)
}
