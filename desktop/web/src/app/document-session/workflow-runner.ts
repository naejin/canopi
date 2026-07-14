export type DesignSessionWorkflowDisposer = () => void

export interface DesignSessionWorkflowContext {}

export interface DesignSessionWorkflow {
  readonly id: string
  install(context: DesignSessionWorkflowContext): DesignSessionWorkflowDisposer | void
}

export interface DesignSessionWorkflowRunner {
  install(): void
  dispose(): void
}

export class DesignSessionWorkflowCleanupError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super('Multiple Design Session workflow cleanups failed')
    this.name = 'DesignSessionWorkflowCleanupError'
  }
}

export class DesignSessionWorkflowInstallError extends Error {
  constructor(
    readonly installError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Design Session workflow installation and cleanup failed')
    this.name = 'DesignSessionWorkflowInstallError'
  }
}

export function createDesignSessionWorkflowRunner(
  workflows: readonly DesignSessionWorkflow[],
  context: DesignSessionWorkflowContext = {},
): DesignSessionWorkflowRunner {
  let disposers: DesignSessionWorkflowDisposer[] = []

  function dispose(): void {
    const current = disposers
    disposers = []
    const cleanup = runWorkflowCleanups(current)
    disposers = cleanup.failed
    throwWorkflowCleanupErrors(cleanup.errors)
  }

  return {
    install(): void {
      dispose()
      const nextDisposers: DesignSessionWorkflowDisposer[] = []
      try {
        for (const workflow of workflows) {
          const disposer = workflow.install(context)
          if (disposer) nextDisposers.push(disposer)
        }
      } catch (error) {
        const cleanup = runWorkflowCleanups(nextDisposers)
        disposers = cleanup.failed
        if (cleanup.errors.length > 0) {
          throw new DesignSessionWorkflowInstallError(error, cleanup.errors)
        }
        throw error
      }
      disposers = nextDisposers
    },
    dispose,
  }
}

function runWorkflowCleanups(
  current: readonly DesignSessionWorkflowDisposer[],
): {
  readonly failed: DesignSessionWorkflowDisposer[]
  readonly errors: unknown[]
} {
  const failed: DesignSessionWorkflowDisposer[] = []
  const errors: unknown[] = []
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const disposer = current[i]!
    try {
      disposer()
    } catch (error) {
      failed.unshift(disposer)
      errors.push(error)
    }
  }
  return { failed, errors }
}

function throwWorkflowCleanupErrors(errors: readonly unknown[]): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new DesignSessionWorkflowCleanupError(errors)
}
