// Callable Playwright page function; no new test-runner dependency.
// Navigate to this gallery's origin first, then pass this file to browser_run_code.
(async (page) => {
  const origin = await page.evaluate(() => location.origin);
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('Use the local UI gallery.');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({ width: 1280, height: 850 });
    for (const edition of ['desktop', 'web']) {
      await page.goto(`${origin}/?surface=workspace&edition=${edition}`);
      await page.locator('[data-gallery-ready="true"]').waitFor();
      for (const panel of ['data', 'analysis']) {
        await page.locator(`[data-gallery-workspace-panel="${panel}"]`).click();
        await page.locator(`[data-workspace-side-panel="${panel}"]`).waitFor();
      }
    }
    await page.goto(`${origin}/library-reference.html?state=empty`);
    await page.getByRole('button', { name: '+ Import', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    check(await page.getByText('Your data, ready to reuse', { exact: true }).count() === 1, 'Picker cancel created data.');
    await page.getByRole('button', { name: '+ Import', exact: true }).click();
    await page.getByRole('button', { name: 'Use selected files', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Browser test terrain');
    await page.getByRole('button', { name: 'Import 2 files', exact: true }).click();
    await page.getByRole('combobox', { name: 'Current Design' }).selectOption('meadow');
    await page.getByRole('button', { name: 'Fail import', exact: true }).click();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Complete import', exact: true }).click();
    await page.getByRole('button', { name: 'Add Browser test terrain to Design', exact: true }).click();
    await page.getByRole('button', { name: 'Open Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Browser test terrain Elevation', exact: true }).click();
    await page.getByRole('button', { name: 'Fit to data', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await page.getByRole('button', { name: 'Sample centre', exact: true }).click();
    check(await page.getByText('118.6 m · illustrative sample', { exact: true }).count() === 1, 'No illustrative sample.');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.keyboard.press('Escape');
    check(await page.getByRole('button', { name: 'Sample centre', exact: true }).count() === 0, 'Escape did not end inspection.');
    await page.getByRole('button', { name: 'Remove from Design', exact: true }).click();
    await page.getByRole('combobox', { name: 'Current Design' }).selectOption('orchard');
    await page.getByRole('button', { name: 'Open Data Library', exact: true }).click();
    await page.getByRole('button', { name: 'Back to library', exact: false }).click();
    await page.getByRole('searchbox', { name: 'Search data' }).fill('Browser test');
    await page.locator('#item-import-1').click();
    await page.getByRole('button', { name: 'Back to library', exact: false }).click();
    check(await page.getByRole('searchbox').inputValue() === 'Browser test', 'Back lost search.');
    check(await page.evaluate(() => document.activeElement?.id) === 'item-import-1', 'Back lost focus.');
    await page.getByRole('button', { name: 'Add Browser test terrain to Design', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for Browser test terrain', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Browser test renamed');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    check(await page.getByRole('button', { name: 'Browser test renamed added' }).count() === 1, 'Rename lost attachment.');
    for (const state of ['ready', 'empty', 'importing', 'failed', 'unavailable', 'long']) {
      await page.goto(`${origin}/library-reference.html?state=${state}&theme=dark`);
      await page.setViewportSize({ width: 390, height: 760 });
      await page.getByRole('heading', { name: 'Data Library', exact: true }).waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), `${state}: horizontal overflow.`);
    }
    check(errors.length === 0, errors.join('\n'));
    return { result: 'passed', coverage: 'Desktop/Web registration; import/cancel/failure/retry; two Designs; Fit/Inspect/zoom/Escape; search/focus; rename; six narrow dark states', errors };
  } finally {
    page.off('pageerror', onError);
  }
})
