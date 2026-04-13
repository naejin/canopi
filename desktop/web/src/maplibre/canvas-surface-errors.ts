export function toMapLibreSurfaceErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  if (typeof error === 'object' && error && 'error' in error) {
    return toMapLibreSurfaceErrorMessage((error as { error?: unknown }).error)
  }
  return 'Unable to load basemap'
}
