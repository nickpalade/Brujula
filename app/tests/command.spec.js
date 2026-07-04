import { test, expect } from '@playwright/test';

// These tests run in offline mock mode (VITE_USE_MOCKS=true, set by
// playwright.config.js). The seeded board (app/src/command/mockApi.js) has:
//   - 3 open incidents: rescue/critical (live victims), water/high, medical/medium
//   - 2 AI dispatch proposals awaiting confirmation
//   - 3 resources, all available
test.beforeEach(async ({ page }) => {
  await page.goto('/command');
  // Wait for the first sync to resolve (skeletons replaced by the feed).
  await expect(page.getByText('Prioritized Action Feed')).toBeVisible();
});

test('renders the command post shell and status badges', async ({ page }) => {
  await expect(page.getByText('BRÚJULA')).toBeVisible();
  await expect(page.getByText('Command Post · La Guaira')).toBeVisible();
  await expect(page.getByText('OFFLINE')).toBeVisible();
  await expect(page.getByText('GEMMA · LOCAL')).toBeVisible();
  await expect(page.getByText('MOCK DATA')).toBeVisible();
  await expect(page.getByRole('button', { name: /SITREP/ })).toBeVisible();
  // Sync eventually reports success.
  await expect(page.getByText(/SYNCED/)).toBeVisible({ timeout: 10_000 });
});

test('shows prioritized incidents with critical first', async ({ page }) => {
  const feed = page.locator('.cmd-feed__list');
  await expect(feed.locator('.cmd-incident')).toHaveCount(3);

  // Critical rescue with live victims must be first and flagged.
  const first = feed.locator('.cmd-incident').first();
  await expect(first).toContainText('Playa Grande');
  await expect(first.getByText('LIVE VICTIMS')).toBeVisible();

  // Header counts reflect one critical + total incidents.
  await expect(page.getByText('1 CRITICAL')).toBeVisible();
  await expect(page.getByText('3 incidents')).toBeVisible();
});

test('lists AI dispatch proposals awaiting confirmation', async ({ page }) => {
  await expect(page.getByText('2 AWAITING')).toBeVisible();
  const proposals = page.locator('.cmd-proposal');
  await expect(proposals).toHaveCount(2);
  await expect(proposals.first().getByText('AI PROPOSES DISPATCH')).toBeVisible();
  await expect(proposals.first().getByText('RATIONALE')).toBeVisible();
});

test('lists resource inventory as available', async ({ page }) => {
  const resources = page.locator('.cmd-resource');
  await expect(resources).toHaveCount(3);
  await expect(page.getByText('3/3 available')).toBeVisible();
  // Scope to the inventory list — the label also appears in a dispatch proposal.
  await expect(
    page.locator('.cmd-resource__label', { hasText: 'Excavator + 5-person crew (idle)' }),
  ).toBeVisible();
});

test('keeps right-rail panels readable instead of shrinking their bodies', async ({ page }) => {
  const resourcePanel = page.locator('.cmd-rail__panel--resources');
  const resourceBody = resourcePanel.locator('.bru-panel__body');

  await expect(resourceBody).toBeVisible();
  expect((await resourceBody.boundingBox()).height).toBeGreaterThan(100);
  expect(await resourcePanel.evaluate((element) => getComputedStyle(element).flexShrink)).toBe('0');
});

test('opens the incident drawer with dispatch, reports and advisory', async ({ page }) => {
  await page.locator('.cmd-incident').first().click();

  const drawer = page.getByRole('dialog', { name: 'Incident detail' });
  await expect(drawer).toBeVisible();
  // Location shows in both the header and the meta row — first match is enough.
  await expect(drawer.getByText('Playa Grande', { exact: false }).first()).toBeVisible();

  // Dedup evidence: two reports merged into the collapse incident.
  await expect(drawer.getByText('2 REPORTS MERGED')).toBeVisible();

  // Protocol advisory loads (rescue steps).
  await expect(drawer.getByText(/silence periods/i)).toBeVisible({ timeout: 10_000 });

  // Close the drawer.
  await drawer.getByRole('button', { name: 'Close incident detail' }).click();
  await expect(drawer).toBeHidden();
});

test('confirms an AI dispatch proposal (money shot)', async ({ page }) => {
  await expect(page.getByText('2 AWAITING')).toBeVisible();
  const firstProposal = page.locator('.cmd-proposal').first();

  await firstProposal.getByRole('button', { name: /CONFIRM/ }).click();

  // After confirm+refresh the board should show one fewer proposal awaiting
  // and a committed resource.
  await expect(page.getByText('1 AWAITING')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.cmd-resource[data-committed="true"]')).toHaveCount(1);
});

test('overrides a dispatch with a different resource', async ({ page }) => {
  const firstProposal = page.locator('.cmd-proposal').first();
  await firstProposal.getByRole('button', { name: 'OVERRIDE' }).click();

  const select = firstProposal.locator('select.cmd-select');
  await expect(select).toBeVisible();
  await select.selectOption({ index: 1 });

  await firstProposal.getByRole('button', { name: 'CONFIRM OVERRIDE' }).click();
  await expect(page.getByText('1 AWAITING')).toBeVisible({ timeout: 10_000 });
});

test('generates and displays a SITREP', async ({ page }) => {
  await page.getByRole('button', { name: /SITREP/ }).click();

  const modal = page.getByRole('dialog', { name: 'Situation report' });
  await expect(modal).toBeVisible();
  // Report text renders after the mock model latency.
  await expect(modal.getByText(/SITREP/)).toBeVisible({ timeout: 10_000 });
  await expect(modal.getByText(/OPEN INCIDENTS/)).toBeVisible();

  await modal.getByRole('button', { name: /Close/ }).click();
  await expect(modal).toBeHidden();
});

test('opens the broadcast alert as an interactive modal', async ({ page }) => {
  await page.getByRole('button', { name: /^(Broadcast alert|Alert)$/i }).click();

  const modal = page.getByRole('dialog', { name: 'Broadcast Alert' });
  await expect(modal).toBeVisible();
  await expect(modal).toBeInViewport();
  await expect(modal.getByPlaceholder(/Tsunami warning/i)).toBeFocused();

  const modalBox = await modal.boundingBox();
  expect(modalBox?.width ?? 0).toBeGreaterThan(300);
  expect(modalBox?.height ?? 0).toBeGreaterThan(200);

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('changes the summary language', async ({ page }) => {
  await page.getByRole('button', { name: 'Command post settings' }).click();
  const langSelect = page.getByLabel('Summary language');
  await expect(langSelect).toBeVisible();
  await langSelect.selectOption('es');
  await expect(langSelect).toHaveValue('es');
});

test('shows a QR code and link to connect a phone', async ({ page }) => {
  await page.getByRole('button', { name: 'Command post settings' }).click();
  await page.getByRole('button', { name: /Connect a field phone/ }).click();

  const modal = page.getByRole('dialog', { name: 'Connect a phone' });
  await expect(modal).toBeVisible();

  // A QR code renders (qrcode.react draws an <svg>, not role=img).
  await expect(modal.locator('.cmd-connect__qr svg')).toBeVisible();

  // The link points at /field on the current origin.
  const link = modal.locator('.cmd-connect__link');
  await expect(link).toContainText('/field');

  await page.screenshot({ path: 'test-results/connect-phone.png' });

  // Copy button is present and clickable.
  await modal.getByRole('button', { name: /Copy link/ }).click();

  // Close it.
  await modal.getByRole('button', { name: /Close/ }).click();
  await expect(modal).toBeHidden();
});
