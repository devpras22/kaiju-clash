// Headless screenshot helper for agents: node tools/shot.mjs <out.png> [script.js] [--wait ms]
// Opens http://localhost:5173 in its own headless Chromium (independent of other agents), optionally runs a
// page script (an async function body with access to window.__game), waits, then screenshots. Prints console errors.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
const out = process.argv[2] || '/tmp/shot.png';
const scriptFile = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const waitIdx = process.argv.indexOf('--wait');
const wait = waitIdx > 0 ? +process.argv[waitIdx + 1] : 1500;
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const dirs = fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse();
let exe;
for (const d of dirs) {
  for (const p of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
    const f = path.join(cache, d, p); if (fs.existsSync(f)) { exe = f; break; }
  }
  if (exe) break;
}
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(process.env.URL || 'http://localhost:5173', { waitUntil: 'load' });
await page.waitForTimeout(800);
let result;
if (scriptFile) {
  const body = fs.readFileSync(scriptFile, 'utf8');
  result = await page.evaluate(`(async () => { const g = window.__game; const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${body} })()`);
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, result, errors }, null, 2));
await browser.close();
