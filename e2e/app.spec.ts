import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = pathToFileURL(resolve(root, 'dist/index.html')).href;
const example = (name: string) => resolve(root, 'examples', name);

test.beforeEach(async ({ page }) => { await page.goto(app); });

test('standalone artifact starts without network requests or JavaScript errors', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('文生图');
  await expect(page.locator('.graph-node')).toHaveCount(9);
  await expect(page.getByTestId('inspector')).toContainText('KSampler');
  await expect(page.getByText('当前检查项未发现问题')).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test('search, select and keyboard navigation expose actual node parameters', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索节点或 ID' }).fill('LoraLoader');
  await expect(page.locator('.node-list-item')).toHaveCount(1);
  await page.locator('.node-list-item').click();
  await expect(page.getByTestId('inspector')).toContainText('watercolor-lines.safetensors');
  await page.getByRole('searchbox').fill('');
  await page.locator('[data-node-id="2"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('inspector')).not.toContainText('水彩风格 LoRA');
  const prior = await page.locator('.status-message').textContent();
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  expect(prior).toContain('已定位');
});

test('broken sample produces actionable errors and filtering works', async ({ page }) => {
  await page.locator('#sample-select').selectOption('broken');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('待修复');
  await expect(page.locator('.diagnostic-row.error').first()).toBeVisible();
  await page.getByLabel('筛选诊断级别').selectOption('info');
  await expect(page.locator('.diagnostic-row.error')).toHaveCount(0);
  await expect(page.getByText('节点已静音', { exact: true })).toBeVisible();
  await page.locator('.diagnostic-nodes button').first().click();
  await expect(page.getByTestId('inspector')).toContainText('KSampler');
});

test('PNG import restores the workflow without false structural warnings', async ({ page }) => {
  await page.getByTestId('workflow-file-input').setInputFiles(example('workflow-metadata.png'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('workflow-metadata.png');
  await expect(page.locator('.graph-node')).toHaveCount(9);
  await expect(page.getByText('当前检查项未发现问题')).toBeVisible();
});

test('invalid import preserves current workflow and can recover', async ({ page }) => {
  await page.getByTestId('workflow-file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('JSON');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('文生图');
  await page.getByTestId('workflow-file-input').setInputFiles(example('api-prompt.json'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('api-prompt.json');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.graph-node')).toHaveCount(7);
});

test('inventory status is evidence based and resets on clear', async ({ page }) => {
  await page.getByRole('button', { name: /^依赖清单/ }).click();
  await expect(page.locator('.dependency-status.available')).toHaveCount(0);
  await page.getByTestId('inventory-file-input').setInputFiles(example('object-info.json'));
  await expect(page.locator('.dependency-status.available')).toHaveCount(8);
  await expect(page.locator('.dependency-status.unknown')).toHaveCount(2);
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(page.locator('.dependency-status.available')).toHaveCount(0);
});

test('semantic diff identifies actual edits while ignoring canvas movement', async ({ page }) => {
  await page.getByRole('button', { name: /^版本对比/ }).click();
  await page.getByRole('button', { name: '对比样例修订', exact: true }).click();
  await expect(page.locator('.diff-direction')).toContainText('修订版');
  await expect(page.locator('.diff-list')).toContainText('0.85');
  await expect(page.locator('.diff-list')).toContainText('sunrise');
  await expect(page.locator('.diff-row-heading code')).toHaveText(['widgets', 'widgets', 'widgets']);
  await page.getByTestId('comparison-file-input').setInputFiles(example('platform-workflow.json'));
  await expect(page.getByText(/未发现语义变化/)).toBeVisible();
});

test('incomparable formats never claim semantic equality', async ({ page }) => {
  await page.getByTestId('comparison-file-input').setInputFiles(example('api-prompt.json'));
  await expect(page.locator('.diff-notice')).toContainText(/格式/);
  await expect(page.getByText(/未发现语义变化/)).toHaveCount(0);
});

test('report and dependency downloads contain inspected evidence', async ({ page }) => {
  const reportWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告', exact: true }).click();
  const report = await reportWait;
  expect(report.suggestedFilename()).toBe('comfytrace-report.md');
  const text = await readFile((await report.path())!, 'utf8');
  expect(text).toContain('Nodes: 9');
  expect(text).toContain('illustration');
  await page.getByRole('button', { name: /^依赖清单/ }).click();
  const manifestWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出清单', exact: true }).click();
  const manifest = await manifestWait;
  const data = JSON.parse(await readFile((await manifest.path())!, 'utf8'));
  expect(data.schemaVersion).toBe(1);
  expect(data.dependencies.filter((item: { kind: string }) => item.kind === 'model')).toHaveLength(2);
});

test('imported markup is displayed as inert text', async ({ page }) => {
  const data = { '1': { class_type: 'SaveImage', _meta: { title: '<img src=x onerror="window.PWNED=1">' }, inputs: { text: '<script>alert(1)</script>' } } };
  await page.getByTestId('workflow-file-input').setInputFiles({ name: 'untrusted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByTestId('inspector')).toContainText('<script>alert(1)</script>');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).PWNED)).toBeUndefined();
  await expect(page.locator('.inspector img')).toHaveCount(0);
});

test('desktop interface passes WCAG accessibility checks', async ({ page }) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile layout has no horizontal document overflow and remains accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: '导入工作流', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^版本对比/ }).click();
  await page.getByRole('button', { name: '对比样例修订', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('drag and drop uses the same validated import path', async ({ page }) => {
  const data = await readFile(example('api-prompt.json'), 'utf8');
  await page.locator('main').evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'dropped.json', { type: 'application/json' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, data);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('dropped.json');
  await expect(page.locator('.graph-node')).toHaveCount(7);
});

test('large graph keeps rendering bounded and later nodes remain inspectable', async ({ page }) => {
  const data = Object.fromEntries(Array.from({ length: 2000 }, (_, id) => [String(id), {
    class_type: 'SaveImage', inputs: { filename_prefix: `sample-${id}` },
  }]));
  await page.getByTestId('workflow-file-input').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('large.json');
  await expect(page.locator('.graph-node')).toHaveCount(160);
  await expect(page.locator('.diagnostic-row')).toHaveCount(100);
  await page.getByRole('button', { name: '诊断下一页', exact: true }).click();
  await expect(page.getByLabel('诊断当前页')).toHaveText('2 / 20');
  await page.getByRole('searchbox').fill('1999');
  await page.locator('.node-list-item').click();
  await expect(page.getByTestId('inspector')).toContainText('sample-1999');
  await expect(page.locator('[data-node-id="1999"]')).toBeVisible();
  await expect(page.locator('.graph-node')).toHaveCount(160);
});
