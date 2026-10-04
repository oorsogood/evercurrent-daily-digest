import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe.configure({ mode: 'serial' });

/** Records every request that asks the server to generate (the only path that can reach the LLM). */
function trackGenerations(page: Page) {
  const generations: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/digest') && r.postDataJSON()?.generate === true)
      generations.push(r.postData() ?? '');
  });
  return generations;
}
const status = (page: Page) => page.getByRole('status');
const items = (page: Page) => page.locator('.digest-item p');
const select = (page: Page, name: string) => page.getByLabel(name, { exact: true });

test('Run Digest analyzes threads, writes the digest, and labels every point', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveText(/Not generated for these filters/);
  await expect(page.getByText('Threads have not been analyzed yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Run Digest' }).click();
  await expect(status(page)).toHaveText('Generated · 19 LLM calls', { timeout: 15_000 });
  await expect(items(page).first()).toBeVisible();
  const count = await items(page).count();
  expect(count).toBeGreaterThan(3);
  expect(count).toBeLessThanOrEqual(7);
  for (const item of await page.locator('.digest-item').all()) {
    await expect(item.getByText(/^Urgency: (High|Medium|Low)$/)).toBeVisible();
    await expect(item.getByText(/^Relevance: (High|Medium|Low)$/)).toBeVisible();
    await expect(item.getByRole('button', { name: /Source/ })).toBeVisible();
  }
  await expect(page.locator('.digest-item').first().getByText('Urgency: High')).toBeVisible();
});

test('filter changes never generate; revisiting cached filters costs zero calls', async ({ page }) => {
  const generations = trackGenerations(page);
  await page.goto('/');
  await expect(status(page)).toHaveText('Cached · 0 LLM calls');
  const alex = await items(page).allTextContents();
  await select(page, 'User').selectOption('sam');
  await expect(status(page)).toHaveText('Not generated for these filters');
  await select(page, 'Focus').selectOption('supply');
  await select(page, 'Project').selectOption('robot-arm');
  await select(page, 'Relationship').selectOption('owner');
  await select(page, 'Project').selectOption('all');
  await select(page, 'Focus').selectOption('validation');
  await select(page, 'User').selectOption('alex');
  await expect(status(page)).toHaveText('Cached · 0 LLM calls');
  expect(await items(page).allTextContents()).toEqual(alex);
  expect(generations).toEqual([]);
});

test('a new combination needs one Run Digest call and produces a different digest', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveText('Cached · 0 LLM calls');
  const alex = await items(page).allTextContents();
  await select(page, 'User').selectOption('sam');
  await page.getByRole('button', { name: 'Run Digest' }).click();
  await expect(status(page)).toHaveText('Generated · 1 LLM call', { timeout: 10_000 });
  expect(await items(page).allTextContents()).not.toEqual(alex);
});

test('relationship is editable only for a single project and defaults from the user', async ({ page }) => {
  await page.goto('/');
  await expect(select(page, 'Relationship')).toBeDisabled();
  await select(page, 'Project').selectOption('robot-arm');
  await expect(select(page, 'Relationship')).toBeEnabled();
  await expect(select(page, 'Relationship')).toHaveValue('owner');
  await select(page, 'User').selectOption('sam');
  await expect(select(page, 'Relationship')).toHaveValue('follower');
});

test('Source opens the original thread with cited messages highlighted', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveText('Cached · 0 LLM calls');
  await page
    .locator('.digest-item')
    .first()
    .getByRole('button', { name: /Source/ })
    .click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Source thread' })).toBeVisible();
  await expect(drawer.locator('li.cited').first()).toBeVisible();
  await expect(drawer.getByText('Cited').first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Close source' }).click();
  await expect(drawer).toBeHidden();
});

test('has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveText('Cached · 0 LLM calls');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.length}`),
  ).toEqual([]);
});
