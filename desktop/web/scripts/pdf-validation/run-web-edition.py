"""Exercise the built Web Edition file command and browser download adapter."""
import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--url', default='http://127.0.0.1:4173/app/web.html')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
parser.add_argument('--chrome', action='store_true')
args = parser.parse_args()
assert urlparse(args.url).hostname == '127.0.0.1'
args.output.mkdir(parents=True, exist_ok=False)

# An authored, portable Design: deliberately enough full botanical names to need
# continuation pages. The app parses/imports it through its normal document seam.
def design():
    return {'version': 5, 'name': 'Web PDF verification', 'description': None, 'location': None, 'north_bearing_deg': 0,
            'plant_species_colors': {}, 'plant_species_symbols': {},
            'layers': [{'name': name, 'visible': True, 'locked': False, 'opacity': 1} for name in ['plants', 'zones', 'annotations', 'measurement-guides']],
            'plants': [{'id': str(i), 'canonical_name': f'Species {i:03}', 'common_name': None,
                        'position': {'x': i % 10, 'y': i // 10}, 'color': '#4f722f', 'symbol': 'tree', 'pinned_name': False,
                        'rotation': None, 'scale': None, 'notes': None, 'planted_date': None, 'quantity': 1} for i in range(90)],
            'zones': [], 'annotations': [], 'measurement_guides': [], 'groups': [], 'consortiums': [], 'timeline': [], 'budget': [],
            'budget_currency': 'EUR', 'created_at': '2026-09-09T00:00:00Z', 'updated_at': '2026-09-09T00:00:00Z', 'extra': {}}


async def main():
    async with async_playwright() as pw:
        browser = await getattr(pw, args.browser).launch(**({'channel': 'chrome'} if args.chrome else {}))
        try:
            page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            await page.goto(args.url)
            async with page.expect_file_chooser() as chooser:
                await page.get_by_role('button', name='Open Design', exact=True).click()
            await (await chooser.value).set_files({'name': 'garden.canopi', 'mimeType': 'application/json', 'buffer': json.dumps(design()).encode()})
            await page.get_by_role('button', name='File', exact=True).click()
            await page.get_by_text('Export to PDF', exact=True).click()
            consent = page.get_by_role('button', name='Add legend pages', exact=True)
            withdraw = page.get_by_role('button', name='Remove legend pages', exact=True)
            save = page.get_by_role('button', name='Save PDF', exact=True)
            await expect(consent).to_be_visible(timeout=30_000)
            await expect(save).to_be_disabled()
            await consent.click()
            await expect(save).to_be_enabled(timeout=30_000)
            for number in range(2):
                async with page.expect_download() as download:
                    await save.click()
                await (await download.value).save_as(args.output / f'export-{number + 1}.pdf')
                await expect(page.get_by_text('PDF download requested.', exact=True)).to_be_visible()
            await page.get_by_role('dialog').get_by_role('button', name='← Back to design', exact=True).click()
            await page.get_by_role('button', name='File', exact=True).click()
            await page.get_by_text('Export to PDF', exact=True).click()
            await expect(withdraw).to_be_visible(timeout=30_000)
            await withdraw.click()
            await expect(save).to_be_disabled()
            # Exercise the workspace through public UI and SVG coordinates.
            await page.get_by_role('button', name='Add page', exact=True).click()
            editor = page.locator('[data-pdf-editor]')
            points = await editor.evaluate('''svg => {
              const frame = svg.querySelector('clipPath rect');
              const x = +frame.getAttribute('x'), y = +frame.getAttribute('y');
              const w = +frame.getAttribute('width'), h = +frame.getAttribute('height');
              return [[x + w * .2, y + h * .2], [x + w * .8, y + h * .65]].map(([x,y]) => {
                const p = new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
                return {x:p.x,y:p.y};
              });
            }''')
            await page.mouse.move(**points[0])
            await page.mouse.down()
            await page.mouse.move(**points[1], steps=5)
            await page.mouse.up()
            await expect(page.get_by_role('button', name='View page: Print area 1', exact=True)).to_have_attribute('aria-current', 'page')
            zoom = page.get_by_role('spinbutton', name='Canvas zoom (%)', exact=True)
            await expect(zoom).to_have_value('100')
            await zoom.fill('125.5')
            # Blur must not swallow the immediately following orientation click.
            await page.get_by_role('button', name='Portrait', exact=True).click()
            await expect(zoom).to_have_value('125.5')
            await expect(page.get_by_role('button', name='Portrait', exact=True)).to_have_attribute('aria-pressed', 'true')
            await page.wait_for_function("document.querySelector('[data-pdf-editor]')?.parentElement?.getAttribute('aria-busy') === 'false'")
            await editor.focus()
            assert await editor.evaluate('svg => document.activeElement === svg')
            await page.keyboard.press('ArrowRight')
            await page.wait_for_function("document.querySelector('[data-pdf-editor]')?.parentElement?.getAttribute('aria-busy') === 'false'")
            await page.get_by_role('button', name='Inspect text', exact=True).click()
            assert await editor.get_attribute('width') != '100%'
            await page.keyboard.press('Escape')
            await expect(editor).to_have_attribute('width', '100%')
            await page.get_by_role('button', name='Fit', exact=True).click()
            await expect(zoom).to_have_value('100')
            await page.get_by_role('button', name='View page: Overview', exact=True).click()
            await page.locator('[data-pdf-target]').first.click()
            await expect(page.get_by_role('button', name='View page: Print area 1', exact=True)).to_have_attribute('aria-current', 'page')
            await page.set_viewport_size({'width': 860, 'height': 700})
            await page.screenshot(path=args.output / 'workspace.png')
            assert await page.evaluate('document.body.scrollWidth') == 860
            await page.get_by_role('button', name='Remove page: Print area 1', exact=True).click()
            await expect(page.get_by_role('button', name='View page: Overview', exact=True)).to_have_attribute('aria-current', 'page')
            report = {'browser': args.browser, 'version': browser.version, 'userAgent': await page.evaluate('navigator.userAgent'),
                      'fileImport': True, 'explicitContinuationChoice': True, 'repeatedDownloads': 2, 'retainedSetup': True, 'drawnPage': True, 'zoomThenOrientation': True,
                      'keyboardFraming': True, 'temporaryInspection': True, 'overviewNavigation': True, 'compactWorkspace': True, 'pageRemoval': True}
            (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report))
        finally:
            await browser.close()

asyncio.run(main())
