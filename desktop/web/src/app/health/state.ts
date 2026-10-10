import { signal } from '@preact/signals'
import type { LidarLibraryStatus, LocalDataStatus, PlantDbStatus } from '../../types/health'

/** Plant DB subsystem health — queried from Rust on startup. */
export const plantDbStatus = signal<PlantDbStatus>('available')

/**
 * How the Data library opened — queried with the plant DB. `refused_newer` and
 * `unavailable` mean the library is empty and read-only for this session.
 */
export const lidarLibraryStatus = signal<LidarLibraryStatus>({ kind: 'ready' })

/**
 * Whether this start moved local data from before Canopi 2.0 aside (ADR 0021).
 * The native side reports `moved_aside` on that start only; dismissing the
 * notice sets it back to `current` for the session.
 */
export const localDataStatus = signal<LocalDataStatus>({ kind: 'current' })
