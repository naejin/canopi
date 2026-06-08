import { describe, expect, it, vi } from 'vitest'
import {
  createDesignSessionWorkflowRunner,
  type DesignSessionWorkflow,
} from '../app/document-session/workflow-runner'

describe('Design Session workflow runner', () => {
  it('reinstalls workflows by disposing the previous run first', () => {
    const disposers: Array<ReturnType<typeof vi.fn>> = []
    const workflow: DesignSessionWorkflow = {
      id: 'test-workflow',
      install: vi.fn(() => {
        const dispose = vi.fn()
        disposers.push(dispose)
        return dispose
      }),
    }
    const runner = createDesignSessionWorkflowRunner([workflow])

    runner.install()
    runner.install()

    expect(workflow.install).toHaveBeenCalledTimes(2)
    expect(disposers[0]).toHaveBeenCalledTimes(1)
    expect(disposers[1]).not.toHaveBeenCalled()

    runner.dispose()
    runner.dispose()

    expect(disposers[0]).toHaveBeenCalledTimes(1)
    expect(disposers[1]).toHaveBeenCalledTimes(1)
  })

  it('disposes installed workflows in reverse order', () => {
    const events: string[] = []
    const workflows: DesignSessionWorkflow[] = [
      {
        id: 'first',
        install: () => {
          events.push('install:first')
          return () => events.push('dispose:first')
        },
      },
      {
        id: 'second',
        install: () => {
          events.push('install:second')
          return () => events.push('dispose:second')
        },
      },
    ]
    const runner = createDesignSessionWorkflowRunner(workflows)

    runner.install()
    runner.dispose()

    expect(events).toEqual([
      'install:first',
      'install:second',
      'dispose:second',
      'dispose:first',
    ])
  })
})
