export function runCanvasRuntimeCleanups(
  cleanups: readonly (() => void)[],
  message: string,
): void {
  const errors: unknown[] = []
  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  throwCanvasRuntimeCleanupErrors(errors, message)
}

export function throwCanvasRuntimeCleanupErrors(
  errors: readonly unknown[],
  message: string,
): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new CanvasRuntimeCleanupError(message, errors)
}

export class CanvasRuntimeCleanupError extends Error {
  constructor(message: string, readonly errors: readonly unknown[]) {
    super(message)
    this.name = 'CanvasRuntimeCleanupError'
  }
}
