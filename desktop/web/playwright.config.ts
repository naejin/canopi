// Web Edition browser checks (canopi-9x95, canvas v2 plan section 3.2).
// The built Web Edition (`npm run build:web`, `dist-web/`) is served by `vite preview`
// and driven in Chromium (stands in for WebView2) and WebKit (stands in for WKWebView).
// Baselines are made only in the pinned image mcr.microsoft.com/playwright:v1.63.0-noble,
// the CI job's container; screenshots from the host's own browsers are never committed.
// After recording, run the suite in that image on fewer cores than the hosted runner's four
// (`docker run --cpus=2 … npx playwright test e2e/canvas --repeat-each=3`): a screenshot of a
// state that a timer is still due to change passes on a fast workstation and fails there.
import { defineConfig } from '@playwright/test'

const PORT = 4174
const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  // A flaky screenshot is a bug to fix (settle first), never something to retry past.
  retries: 0,
  forbidOnly: isCI,
  // The same on a workstation as on the hosted runner (four cores); a spec file's tests run in order.
  workers: 2,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // Measured in the pinned image with tracing on (retain-on-failure records every run): at four
  // cores (the hosted runner's size) the base scenario takes up to 40 s, above Playwright's
  // default 30 s, and at two cores up to 125 s. A screenshot after a Design change waits for
  // the canvas (e2e/support/canvas.ts) and matches its baseline on its first capture, but at two
  // cores that one capture takes up to 6.5 s, opening the fixture up to 12 s and the PDF
  // preview up to 10 s, more than the default 5 s. These limits only bound how long a check
  // waits; they never change what passes.
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Playwright's default comparison, not loosened: no pixel budget (maxDiffPixels 0) and
      // the default per-pixel colour threshold; the pinned image makes the pixels reproducible.
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}/app/web.html`,
    // The size the phase-0 native references use.
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    // Pinned so number and date formatting never follows the host or the image.
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // No device descriptors: they would change the user agent (Desktop Safari claims macOS,
  // which switches the app to Command shortcuts); both engines keep the host platform.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    // Web mode supplies the /app/ base and dist-web; build first with `npm run build:web`.
    command: `npx vite preview --mode web --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app/web.html`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
})
