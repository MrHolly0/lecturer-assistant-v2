#!/usr/bin/env python3
"""Headless real WebRTC decode check against the loopback synthetic SFU harness."""
import asyncio
import json
import importlib.metadata
import os
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    count = int(os.environ.get('SCALE_MEDIA_VIEWERS', '16'))
    if os.environ.get('SCALE_LAB') != 'true' or not 1 <= count <= 32:
        raise SystemExit('Requires SCALE_LAB=true and 1..32 synthetic viewers')
    output = Path('artifacts/scalable-browser-media')
    output.mkdir(parents=True, exist_ok=True)
    report = {'passed': False, 'viewers': count, 'syntheticVideo': True,
        'playwrightVersion': importlib.metadata.version('playwright'),
        'targetResolution': [1280, 720], 'observationSeconds': 5, 'pageErrors': 0,
        'qualification': 'small browser decode check; not 10000 viewers or a 6 Mbps workload'}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=[
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'])
        report['browserVersion'] = browser.version
        context = await browser.new_context(viewport={'width': 1360, 'height': 900})
        try:
            report['phase'] = 'publisher'
            publisher = await context.new_page()
            await publisher.goto('http://127.0.0.1:18090/')
            await publisher.wait_for_load_state('networkidle')
            await publisher.evaluate("window.start('publisher')")
            pages = []
            limit = asyncio.Semaphore(4)

            async def connect(index):
                async with limit:
                    page = await context.new_page()
                    page.on('pageerror', lambda _: report.update(pageErrors=report['pageErrors'] + 1))
                    await page.goto('http://127.0.0.1:18090/')
                    await page.wait_for_load_state('networkidle')
                    await page.evaluate("i => window.start('subscriber', i)", index)
                    await page.wait_for_function('window.framesDecoded() >= 30', timeout=45000)
                    return page

            report['phase'] = 'subscribers'
            tasks = [asyncio.create_task(connect(i)) for i in range(count)]
            try:
                pages = await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            report['phase'] = 'decode-sample'
            before = await asyncio.gather(*(p.evaluate('window.videoStats()') for p in pages))
            await asyncio.sleep(report['observationSeconds'])
            after = await asyncio.gather(*(p.evaluate('window.videoStats()') for p in pages))
            report['receivers'] = []
            for first, last in zip(before, after):
                duration = (last['timestamp'] - first['timestamp']) / 1000
                report['receivers'].append({
                    'decodedFramesDuringSample': last['framesDecoded'] - first['framesDecoded'],
                    'displayedFramesDuringSample': last['displayedFrames'] - first['displayedFrames'],
                    'resolution': [last['frameWidth'], last['frameHeight']],
                    'receivedBytesDuringSample': last['bytesReceived'] - first['bytesReceived'],
                    'sampleBitrateBps': (last['bytesReceived'] - first['bytesReceived']) * 8 / duration if duration > 0 else 0,
                    'packetsLostDuringSample': last['packetsLost'] - first['packetsLost']})
            assert report['pageErrors'] == 0
            assert all(r['resolution'] == [1280, 720] and r['decodedFramesDuringSample'] >= 30
                and r['displayedFramesDuringSample'] >= 30 and r['receivedBytesDuringSample'] > 0
                for r in report['receivers'])
            report['minimumDecodedFrames'] = min(r['decodedFramesDuringSample'] for r in report['receivers'])
            report['maximumSampleBitrateBps'] = max(r['sampleBitrateBps'] for r in report['receivers'])
            await pages[0].screenshot(path=str(output / 'receiver.png'), full_page=True)
            report['passed'] = True
            report['phase'] = 'complete'
        except Exception as error:
            # SDK errors can carry a signalling URL with a ticket. Keep only the error class.
            report['failureType'] = type(error).__name__
        finally:
            await context.close()
            await browser.close()
    (output / 'summary.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'receivers'}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
