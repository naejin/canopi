import { describe, expect, it } from 'vitest'

import { resolveWebEditionDevHtmlUrl } from '../web/dev-entry'

describe('Web Edition development entry', () => {
  it('redirects base and index requests to web.html while preserving the query', () => {
    expect(resolveWebEditionDevHtmlUrl('/app/')).toBe('/app/web.html')
    expect(resolveWebEditionDevHtmlUrl('/app')).toBe('/app/web.html')
    expect(resolveWebEditionDevHtmlUrl('/app/index.html?from=test')).toBe('/app/web.html?from=test')
    expect(resolveWebEditionDevHtmlUrl('/app/web.html')).toBeNull()
  })
})
