import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { demoApi } from '../src/data/demo';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) throw new Error('Provide the deployed app URL as the first argument.');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.resourceType() !== 'document' && /^https?:/.test(request.url())) outbound.push(request.url());
  });
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Deployment returned ${response?.status()}`);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const deployedHash = hash(await response.body());
  expect(deployedHash).toBe(hash(await readFile(new URL('../dist/index.html', import.meta.url))));
  await expect(page.locator('.graph-node')).toHaveCount(9);
  await page.getByRole('button', { name: /^版本对比/ }).click();
  await page.getByRole('button', { name: '对比样例修订', exact: true }).click();
  await expect(page.locator('.diff-row')).toHaveCount(3);
  await page.getByTestId('workflow-file-input').setInputFiles({ name: 'live-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(demoApi)) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('live-check.json');
  await expect(page.locator('.graph-node')).toHaveCount(7);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
  process.stdout.write(JSON.stringify({ url, status: response.status(), sha256: deployedHash, graph: true, diff: true, import: true, externalRequests: outbound.length, errors }, null, 2) + '\n');
} finally { await browser.close(); }
