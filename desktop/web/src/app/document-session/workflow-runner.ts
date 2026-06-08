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

export function createDesignSessionWorkflowRunner(
  workflows: readonly DesignSessionWorkflow[],
  context: DesignSessionWorkflowContext = {},
): DesignSessionWorkflowRunner {
  let disposers: DesignSessionWorkflowDisposer[] = []

  function dispose(): void {
    const current = disposers
    disposers = []
    for (let i = current.length - 1; i >= 0; i -= 1) {
      current[i]!()
    }
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
        for (let i = nextDisposers.length - 1; i >= 0; i -= 1) {
          nextDisposers[i]!()
        }
        throw error
      }
      disposers = nextDisposers
    },
    dispose,
  }
}
