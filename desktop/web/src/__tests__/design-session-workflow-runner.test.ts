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

  it('runs every cleanup and retries only failed workflow obligations', () => {
    const firstDisposer = vi.fn()
    const secondFailure = new Error('second cleanup failed')
    const thirdFailure = new Error('third cleanup failed')
    let secondAttempt = 0
    let thirdAttempt = 0
    const secondDisposer = vi.fn(() => {
      secondAttempt += 1
      if (secondAttempt === 1) throw secondFailure
    })
    const thirdDisposer = vi.fn(() => {
      thirdAttempt += 1
      if (thirdAttempt === 1) throw thirdFailure
    })
    const runner = createDesignSessionWorkflowRunner([
      { id: 'first', install: () => firstDisposer },
      { id: 'second', install: () => secondDisposer },
      { id: 'third', install: () => thirdDisposer },
    ])
    runner.install()

    let cleanupError: unknown
    try {
      runner.dispose()
    } catch (error) {
      cleanupError = error
    }

    expect(cleanupError).toMatchObject({
      name: 'DesignSessionWorkflowCleanupError',
      errors: [thirdFailure, secondFailure],
    })
    expect(thirdDisposer).toHaveBeenCalledOnce()
    expect(secondDisposer).toHaveBeenCalledOnce()
    expect(firstDisposer).toHaveBeenCalledOnce()

    expect(() => runner.dispose()).not.toThrow()
    expect(thirdDisposer).toHaveBeenCalledTimes(2)
    expect(secondDisposer).toHaveBeenCalledTimes(2)
    expect(firstDisposer).toHaveBeenCalledOnce()
    expect(() => runner.dispose()).not.toThrow()
  })

  it('exhausts partial-install cleanup and retains failed cleanup for retry', () => {
    const installFailure = new Error('third install failed')
    const cleanupFailure = new Error('second cleanup failed')
    const firstDisposer = vi.fn()
    let secondAttempt = 0
    const secondDisposer = vi.fn(() => {
      secondAttempt += 1
      if (secondAttempt === 1) throw cleanupFailure
    })
    const runner = createDesignSessionWorkflowRunner([
      { id: 'first', install: () => firstDisposer },
      { id: 'second', install: () => secondDisposer },
      {
        id: 'third',
        install: () => {
          throw installFailure
        },
      },
    ])

    let combinedError: unknown
    try {
      runner.install()
    } catch (error) {
      combinedError = error
    }

    expect(combinedError).toMatchObject({
      name: 'DesignSessionWorkflowInstallError',
      installError: installFailure,
      cleanupErrors: [cleanupFailure],
    })
    expect(secondDisposer).toHaveBeenCalledOnce()
    expect(firstDisposer).toHaveBeenCalledOnce()

    expect(() => runner.dispose()).not.toThrow()
    expect(secondDisposer).toHaveBeenCalledTimes(2)
    expect(firstDisposer).toHaveBeenCalledOnce()
  })
})
