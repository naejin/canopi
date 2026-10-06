export function runCanvasRuntimeCleanups(
  cleanups: readonly (() => void)[],
  message: string,
): void {
  throwCanvasRuntimeCleanupErrors(collectCanvasRuntimeErrors(cleanups), message)
}

/** Runs each step once, in order, and returns what they threw. */
export function collectCanvasRuntimeErrors(steps: readonly (() => void)[]): unknown[] {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
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
