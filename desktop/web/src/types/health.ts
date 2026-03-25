// Mirror of common-types/src/health.rs — keep in sync with Rust types

export interface SubsystemHealth {
  plant_db: PlantDbStatus
}

export type PlantDbStatus = 'available' | 'missing' | 'corrupt'
