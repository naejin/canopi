import { describe, expect, it } from 'vitest'
import tauriConfigText from '../../../tauri.conf.json?raw'

function readTauriCsp(): Record<string, string> {
  const config = JSON.parse(tauriConfigText)
  return config.app.security.csp
}

describe('Tauri CSP', () => {
  it('allows MapLibre blob workers through WebKit worker-src fallback', () => {
    const csp = readTauriCsp()

    expect(csp['worker-src']).toContain('blob:')
    expect(csp['child-src']).toContain('blob:')
  })
})
