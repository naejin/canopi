import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'

function BuggyComponent(): never {
  throw new Error('Test error')
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    vi.restoreAllMocks()
  })

  it('renders children when no error occurs', async () => {
    await act(async () => {
      render(
        <ErrorBoundary><p>Hello</p></ErrorBoundary>,
        container,
      )
    })

    expect(container.textContent).toContain('Hello')
  })

  it('renders fallback UI when a child throws', async () => {
    await act(async () => {
      render(
        <ErrorBoundary><BuggyComponent /></ErrorBoundary>,
        container,
      )
    })

    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain('Something went wrong')
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('renders error details when stack trace is present', async () => {
    await act(async () => {
      render(
        <ErrorBoundary><BuggyComponent /></ErrorBoundary>,
        container,
      )
    })

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.textContent).toContain('Test error')
  })
})
