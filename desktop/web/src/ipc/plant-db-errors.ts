import type { PlantDbStatus } from '../types/health';

const PLANT_DB_UNAVAILABLE_PREFIX = 'Plant database unavailable';

export function plantDbUnavailableMessage(status: PlantDbStatus): string {
  if (status === 'corrupt') {
    return 'Plant database unavailable: bundled plant database is corrupt';
  }
  return 'Plant database unavailable: bundled plant database is missing';
}

export function isPlantDbUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(PLANT_DB_UNAVAILABLE_PREFIX);
}
