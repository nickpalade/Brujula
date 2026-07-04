import { expect, test } from '@playwright/test';

test('landing routes expose every station', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /BRÚJULA/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Grafo de Mando/i })).toHaveAttribute('href', '/graph');
  await expect(page.getByRole('link', { name: /Puesto de Mando/i })).toHaveAttribute('href', '/command');
  await expect(page.getByRole('link', { name: /Cliente de Campo/i })).toHaveAttribute('href', '/field');
});

test('remote devices are blocked from the command post', async ({ page }) => {
  await page.route('**/api/access/command', (route) => route.fulfill({
    json: { success: true, data: { allowed: false }, error: null },
  }));

  await page.goto('/command');

  await expect(page.getByText('Command center locked to host machine')).toBeVisible();
  await expect(page.getByText('Prioritized Action Feed')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open field client' }).click();
  await expect(page).toHaveURL(/\/field$/);
});

test.describe('command post in mock mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/command');
    await expect(page.getByText('Prioritized Action Feed')).toBeVisible();
    await expect(page.getByText(/synced \d+ seconds? ago/i)).toBeVisible({ timeout: 10_000 });
  });

  test('prioritizes critical incidents and shows dispatch decisions', async ({ page }) => {
    const feed = page.locator('.cmd-feed__list');
    await expect(feed.locator('.cmd-incident')).toHaveCount(3);

    const first = feed.locator('.cmd-incident').first();
    await expect(first).toContainText('Playa Grande');
    await expect(first).toContainText('LIVE VICTIMS');
    await expect(page.getByText('1 CRITICAL')).toBeVisible();

    const proposals = page.locator('.cmd-proposal');
    await expect(page.getByText('2 AWAITING')).toBeVisible();
    await expect(proposals).toHaveCount(2);
    await expect(proposals.first()).toContainText('AI PROPOSES DISPATCH');
    await expect(proposals.first()).toContainText('RATIONALE');
  });

  test('confirms and overrides AI dispatch proposals', async ({ page }) => {
    const proposals = page.locator('.cmd-proposal');
    await expect(proposals).toHaveCount(2);

    await proposals.first().getByRole('button', { name: /^CONFIRM$/ }).click();
    await expect(page.getByText('1 AWAITING')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2 matchable')).toBeVisible();
    await expect(page.locator('.cmd-resource[data-committed="true"]')).toHaveCount(1);

    await proposals.first().getByRole('button', { name: 'OVERRIDE' }).click();
    const picker = proposals.first().locator('select.cmd-select');
    await expect(picker).toBeVisible();
    await picker.selectOption({ index: 1 });
    await proposals.first().getByRole('button', { name: 'CONFIRM OVERRIDE' }).click();
    await expect(page.locator('.cmd-proposal')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Needs Human Decision')).toHaveCount(0);
  });

  test('opens incident detail, generates sitrep, and asks context chat', async ({ page }) => {
    await page.locator('.cmd-incident').first().click();
    const drawer = page.getByRole('dialog', { name: 'Incident detail' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Playa Grande', { exact: false }).first()).toBeVisible();
    await expect(drawer.getByText(/REPORTS MERGED/)).toBeVisible();

    await drawer.getByRole('button', { name: /GENERATE SITREP|SITREP/ }).click();
    const sitrep = page.getByRole('dialog', { name: 'Situation report' });
    await expect(sitrep).toBeVisible();
    await expect(sitrep.getByText(/SITREP/)).toBeVisible({ timeout: 10_000 });
    await sitrep.getByRole('button', { name: /Close/ }).click();
    await drawer.getByRole('button', { name: 'Close incident detail' }).click();

    const chat = page.getByRole('region', { name: 'Decision Assistant' });
    await chat.getByLabel('Ask Gemma about current decisions').fill('Which water resources are available?');
    await chat.getByRole('button', { name: 'Ask' }).click();
    await expect(chat.getByText(/Water tanker/i)).toBeVisible({ timeout: 10_000 });
    await expect(chat.getByText(/Resource Inventory/i)).toBeVisible();
  });

  test('broadcasts and deactivates an alert', async ({ page }) => {
    const message = 'Aftershock warning: keep clear of damaged buildings';

    await page.getByRole('button', { name: /^(Broadcast alert|Alert)$/i }).click();
    const modal = page.getByRole('dialog', { name: 'Broadcast Alert' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder(/Tsunami warning/i).fill(message);
    await modal.locator('select').selectOption('critical');
    await modal.getByPlaceholder(/Catia La Mar/i).fill('Playa Grande');
    await modal.getByRole('button', { name: 'Send Alert' }).click();

    const stripAlert = page.locator('.cmd-alert-item', { hasText: message });
    await expect(stripAlert).toBeVisible();
    await stripAlert.getByRole('button', { name: /Deactivate alert/i }).click();
    await expect(stripAlert).toHaveCount(0);
  });

  test('settings connect phone, density, and offline maps remain operable', async ({ page }) => {
    await page.route('**/api/network-info', (route) => route.fulfill({
      json: { success: true, data: { lan_origin: 'http://192.168.137.1:8000' }, error: null },
    }));
    await page.route('https://basemaps.cartocdn.com/**', (route) => route.abort());

    await page.getByRole('button', { name: 'Command post settings' }).click();
    await page.getByRole('button', { name: 'compact' }).click();
    await expect(page.locator('.cmd-root')).toHaveClass(/cmd-root--compact/);

    await page.getByRole('button', { name: /Connect a field phone/ }).click();
    const connect = page.getByRole('dialog', { name: 'Connect a phone' });
    await expect(connect.locator('.cmd-connect__qr svg')).toBeVisible();
    await expect(connect.locator('.cmd-connect__link')).toHaveText('http://192.168.137.1:8000/field');
    await connect.getByRole('button', { name: /Close/ }).click();

    await page.getByRole('button', { name: 'Command post settings' }).click();
    await page.getByRole('button', { name: /Offline maps/ }).click();
    const offlineMaps = page.getByRole('dialog', { name: 'Offline maps' });
    await expect(offlineMaps).toBeVisible();
    await expect(offlineMaps.locator('.cmd-offline__box')).toBeVisible();
    await expect(offlineMaps.getByText('DOWNLOAD AREA')).toBeVisible();
    await expect(offlineMaps.locator('.cmd-offline__estimate')).toContainText(/tiles/, { timeout: 10_000 });
    await offlineMaps.getByRole('button', { name: /Close/ }).click();
  });

  test('fits common laptop and phone viewports without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/command');
    await expect(page.getByText('Prioritized Action Feed')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 692, height: 949 });
    await page.locator('.cmd-incident').first().click();
    const drawer = page.getByRole('dialog', { name: 'Incident detail' });
    await expect(drawer).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});
