// What the release smoke counts as a problem on a deployed page: page errors, console errors and
// HTTP errors (canopi-x5eu). Two kinds of console error are not problems:
// - "[Report Only]" Content-Security-Policy-Report-Only reports, which block nothing; Cloudflare
//   adds such a header to a sample of responses on the projectcanopi.com zone, not to pages.dev.
// - errors from the page being left, between a main-frame navigation's request and the new
//   document's commit: WebKit fails the old page's in-flight requests (map tiles) as "Load
//   failed" and the map logs them, while Chromium drops them silently.
import type { Page } from '@playwright/test'

export function collectPageProblems(page: Page): string[] {
  const problems: string[] = []
  let leavingPage = false
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) leavingPage = true
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) leavingPage = false
  })
  page.on('pageerror', (error) => {
    if (!leavingPage) problems.push(`page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (leavingPage || message.type() !== 'error' || message.text().startsWith('[Report Only]')) return
    problems.push(`console error: ${message.text().slice(0, 300)}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
  })
  return problems
}
