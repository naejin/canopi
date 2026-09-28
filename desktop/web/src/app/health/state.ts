import { signal } from '@preact/signals'
import type { LidarLibraryStatus, PlantDbStatus } from '../../types/health'

/** Plant DB subsystem health — queried from Rust on startup. */
export const plantDbStatus = signal<PlantDbStatus>('available')

/**
 * How the Data library opened — queried with the plant DB. `refused_newer` and
 * `unavailable` mean the library is empty and read-only for this session.
 */
export const lidarLibraryStatus = signal<LidarLibraryStatus>({ kind: 'ready' })
