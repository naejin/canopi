use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SubsystemHealth {
    pub plant_db: PlantDbStatus,
    pub lidar_library: LidarLibraryStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlantDbStatus {
    Available,
    Missing,
    Corrupt,
}

/// How the LiDAR Data library opened at startup. Everything but `Ready` is
/// shown to the user; `RefusedNewer` and `Unavailable` also make the library
/// empty and read-only for the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LidarLibraryStatus {
    Ready,
    /// An older or corrupt catalogue was set aside and rebuilt from the
    /// originals: `items` listed again from their metadata, `generated` of
    /// them under a generated name because no metadata described them.
    Recovered {
        items: u32,
        generated: u32,
    },
    /// The catalogue was written by a newer Canopi and is left untouched.
    RefusedNewer,
    /// The catalogue could be neither opened nor rebuilt.
    Unavailable,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn health_serialises_every_lidar_library_state() {
        let cases = [
            (LidarLibraryStatus::Ready, json!({ "kind": "ready" })),
            (
                LidarLibraryStatus::Recovered {
                    items: 3,
                    generated: 1,
                },
                json!({ "kind": "recovered", "items": 3, "generated": 1 }),
            ),
            (
                LidarLibraryStatus::RefusedNewer,
                json!({ "kind": "refused_newer" }),
            ),
            (
                LidarLibraryStatus::Unavailable,
                json!({ "kind": "unavailable" }),
            ),
        ];
        for (status, expected) in cases {
            let health = SubsystemHealth {
                plant_db: PlantDbStatus::Available,
                lidar_library: status,
            };
            let value = serde_json::to_value(&health).unwrap();
            assert_eq!(value["plant_db"], json!("available"));
            assert_eq!(value["lidar_library"], expected);
            let back: SubsystemHealth = serde_json::from_value(value).unwrap();
            assert_eq!(back.lidar_library, status);
        }
    }
}
