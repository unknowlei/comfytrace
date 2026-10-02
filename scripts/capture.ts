import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(root, 'dist/index.html')).href);
  await page.getByTestId('inspector').waitFor();
  await page.screenshot({ path: resolve(root, 'docs/screenshot.png'), fullPage: true });
  await page.getByRole('button', { name: /^版本对比/ }).click();
  await page.getByRole('button', { name: '对比样例修订', exact: true }).click();
  await page.screenshot({ path: resolve(root, 'docs/comparison.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(pathToFileURL(resolve(root, 'dist/index.html')).href);
  await page.getByTestId('inspector').waitFor();
  await page.screenshot({ path: resolve(root, 'docs/mobile.png'), fullPage: true });
} finally { await browser.close(); }
