import { signal } from '@preact/signals'
import type { PlantDbStatus } from '../../types/health'

/** Plant DB subsystem health — queried from Rust on startup. */
export const plantDbStatus = signal<PlantDbStatus>('available')
