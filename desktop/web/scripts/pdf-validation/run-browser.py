"""Run production samples in an owned browser; never attach to a user's profile.

Requires Playwright Python 1.58.0 and its browser, or --chrome for installed Chrome.
Serve dist-pdf-validation first. Memory is sampled renderer RSS on Linux Chromium;
it includes worker threads and shared pages, and is not an allocation/leak measure.
"""
import argparse
import asyncio
import base64
import json
from pathlib import Path
import re
import threading
from urllib.parse import urlparse
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--url', default='http://127.0.0.1:4175/')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
parser.add_argument('--chrome', action='store_true')
parser.add_argument('--input', type=Path, help='Private production preparation JSON; replaces public fixtures')
args = parser.parse_args()
assert urlparse(args.url).hostname == '127.0.0.1'
args.output.mkdir(parents=True, exist_ok=False)


def rss(pids):
    total = 0
    for pid in pids:
        try:
            match = re.search(r'^VmRSS:\s+(\d+)', Path(f'/proc/{pid}/status').read_text(), re.M)
            total += int(match[1]) if match else 0
        except FileNotFoundError:
            pass
    return total


async def main():
    async with async_playwright() as pw:
        browser = await getattr(pw, args.browser).launch(**({'channel': 'chrome'} if args.chrome else {}))
        try:
            context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = await context.new_page()
            requests = []
            context.on('request', lambda request: requests.append(request.url))
            cdp = await browser.new_browser_cdp_session() if args.browser == 'chromium' else None
            reports = []
            names = ['dense', 'mixed', 'framing', 'legends', 'multilingual', 'map-excluded', 'stress-1', 'stress-10', 'stress-50']
            custom = json.loads(args.input.read_text()) if args.input else None
            for name in (['private'] if custom else names):
                await page.goto(args.url)
                await page.wait_for_function('!!window.pdfValidation')
                requests.clear()
                pids = [p['id'] for p in (await cdp.send('SystemInfo.getProcessInfo'))['processInfo'] if p['type'] == 'renderer'] if cdp else []
                before = rss(pids)
                peak = [before]
                stop = threading.Event()
                def sample():
                    while not stop.wait(.025):
                        peak[0] = max(peak[0], rss(pids))
                sampler = threading.Thread(target=sample, daemon=True)
                sampler.start()
                try:
                    report = await page.evaluate('([name, custom]) => window.pdfValidation.run(name, custom)', [name, custom])
                finally:
                    stop.set(); sampler.join(timeout=1)
                report['browserVersion'] = browser.version
                report['requests'] = list(requests)
                report['memory'] = {'rendererBeforeKiB': before, 'rendererPeakKiB': peak[0], 'rendererAfterKiB': rss(pids), 'samplePeriodMs': 25, 'pids': pids} if pids else None
                assert all(urlparse(url.removeprefix('blob:')).hostname == '127.0.0.1' for url in requests), requests
                if name.startswith('stress-'):
                    assert sum(p['kind'] != 'legend' for p in report['legends']) == int(name.split('-')[1]), report['pages']
                    assert report['pages'] <= 200
                (args.output / f'{name}.pdf').write_bytes(bytes(await page.evaluate('window.pdfValidation.bytes()')))
                if custom:
                    for i in range(report['pages']):
                        png = await page.evaluate('(i) => window.pdfValidation.png(i)', i)
                        (args.output / f'{name}-preview-{i + 1}.png').write_bytes(base64.b64decode(png, validate=True))
                elif not name.startswith('stress-'):
                    png = await page.evaluate('(i) => window.pdfValidation.png(i)', min(1, report['pages'] - 1))
                    (args.output / f'{name}-preview.png').write_bytes(base64.b64decode(png, validate=True))
                await page.evaluate('window.pdfValidation.clear()')
                report['activeWorkersAfterClear'] = len(page.workers)
                assert report['activeWorkersAfterClear'] == 0
                (args.output / f'{name}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
                reports.append(report)
                print(json.dumps({k: report[k] for k in ['fixture', 'pages', 'plants', 'bytes', 'generationMs', 'memory']}), flush=True)
            if not custom:
                assert next(r for r in reports if r['fixture'] == 'mixed')['planSha256'] == next(r for r in reports if r['fixture'] == 'map-excluded')['planSha256']
            (args.output / 'summary.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2) + '\n')
        finally:
            await browser.close()

asyncio.run(main())
