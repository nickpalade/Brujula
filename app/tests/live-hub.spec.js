import { expect, test } from '@playwright/test';

const HUB_URL = 'http://127.0.0.1:8021';

async function hub(request, path, options = {}) {
  const response = await request.fetch(`${HUB_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  expect(payload.success, `${path} returned ${payload.error ?? response.status()}`).toBe(true);
  return payload.data;
}

test.beforeEach(async ({ request }) => {
  await hub(request, '/__test/reset', { method: 'POST', data: {} });
});

test('field report reaches the live hub and drives command decisions', async ({ browser, page, request }) => {
  await page.goto('/field');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByLabel('Language').selectOption('en');
  await page.getByText('Reporter', { exact: true }).click();
  await page.getByLabel('Your name').fill('Ana Field');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Ana Field · reporter')).toBeVisible();

  await page.getByLabel("What's happening?").fill(
    'Building collapsed in Playa Grande, Catia La Mar. We hear voices and 12 people are trapped. Need heavy machinery now.',
  );
  await page.getByLabel('People').fill('12');
  await page.getByLabel('Location').fill('Playa Grande, Catia La Mar');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Processed').first()).toBeVisible({ timeout: 15_000 });

  await expect.poll(
    async () => {
      const incidents = await hub(request, '/api/incidents');
      return incidents.find((item) => item.location === 'Playa Grande, Catia La Mar');
    },
    { timeout: 10_000 },
  ).toMatchObject({
    category: 'rescue',
    urgency: 'critical',
    people_count: 12,
  });

  const commandContext = await browser.newContext();
  const command = await commandContext.newPage();
  await command.goto('/command');
  await expect(command.getByText('Prioritized Action Feed')).toBeVisible();
  await expect(command.getByText('MOCK DATA')).toHaveCount(0);

  const incidentCard = command.locator('.cmd-incident', { hasText: 'Playa Grande' });
  await expect(incidentCard).toBeVisible({ timeout: 10_000 });
  await expect(incidentCard).toContainText('LIVE VICTIMS');
  await expect(command.locator('.cmd-proposal', { hasText: 'Playa Grande' })).toContainText(
    'Excavator + 5-person crew',
  );

  await incidentCard.click();
  const drawer = command.getByRole('dialog', { name: 'Incident detail' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.cmd-drawer__meta')).toContainText('12 people');
  await expect(drawer.getByText(/Building collapsed/)).toBeVisible();

  const proposal = drawer.locator('.cmd-proposal', { hasText: 'Playa Grande' });
  await proposal.getByRole('button', { name: /^CONFIRM$/ }).click();
  await expect(command.locator('.cmd-resource[data-committed="true"]')).toContainText('Excavator', {
    timeout: 10_000,
  });
  await drawer.getByRole('button', { name: 'Close incident detail' }).click();
  await expect(drawer).toBeHidden();

  await command.getByRole('button', { name: /^(Broadcast alert|Alert)$/i }).click();
  const alert = command.getByRole('dialog', { name: 'Broadcast Alert' });
  await alert.getByPlaceholder(/Tsunami warning/i).fill('Aftershock warning: keep clear of damaged buildings');
  await alert.locator('select').selectOption('critical');
  await alert.getByRole('button', { name: 'Send Alert' }).click();
  await expect(command.getByText('Aftershock warning: keep clear of damaged buildings')).toBeVisible();

  await expect.poll(async () => (await hub(request, '/api/alerts')).length).toBeGreaterThan(0);
  await commandContext.close();
});
