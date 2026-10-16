// The release smoke's problem collector on an intercepted page (no deployment is touched).
import { expect, test } from '@playwright/test'
import { collectPageProblems } from './page-problems'

test('report-only CSP reports are not problems, other console errors are (canopi-x5eu)', async ({ page }) => {
  await page.route('**/__page-problems-check', (route) => route.fulfill({
    contentType: 'text/html',
    // Like Cloudflare's sampled header: a reporting endpoint, and a policy the page breaks.
    headers: { 'Content-Security-Policy-Report-Only': "script-src 'none'; report-uri /__csp-report" },
    body: '<!doctype html><title>check</title><script>console.error("a real error")</script>',
  }))
  await page.route('**/__csp-report', (route) => route.fulfill({ status: 204 }))
  const consoleMessages: string[] = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  const problems = collectPageProblems(page)

  await page.goto('/__page-problems-check')

  // The browser saw the violation (WebKit logs "[Report Only] Refused…" as an error, Chromium logs info).
  await expect.poll(() => consoleMessages.some((text) => /Content Security Policy/.test(text))).toBe(true)
  await expect.poll(() => problems).toEqual(['console error: a real error'])
})

test('errors from the page being left are not problems, errors after the navigation are (canopi-x5eu)', async ({ page, browserName }) => {
  // The left page's request never answers; the navigation fails it, and the page logs that, as the map logs a tile.
  await page.route('**/__slow-tile', () => new Promise(() => {}))
  await page.route('**/__left-page', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>left</title><script>fetch("/__slow-tile").catch((e) => console.error("teardown: " + e.message))</script>',
  }))
  await page.route('**/__next-page', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>next</title><script>console.error("after navigation")</script>',
  }))
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const problems = collectPageProblems(page)

  await Promise.all([page.waitForRequest('**/__slow-tile'), page.goto('/__left-page')])
  await page.goto('/__next-page')

  // WebKit logs the left page's failed request, as on web.projectcanopi.com; Chromium drops it.
  if (browserName === 'webkit') expect(consoleErrors.some((text) => text.startsWith('teardown:'))).toBe(true)
  await expect.poll(() => problems).toEqual(['console error: after navigation'])
})
