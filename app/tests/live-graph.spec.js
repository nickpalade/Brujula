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

test('live field report renders the report -> incident -> dispatch/resource chain in the graph', async ({ page, request }) => {
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

  await page.goto('/graph');
  await expect(page.getByText('Node Graph Command')).toBeVisible();
  await expect(page.getByText('MOCK DATA')).toHaveCount(0);

  // Report -> incident -> dispatch -> resource chain from the live hub.
  const reportNode = page.getByTestId('graph-node-report');
  await expect(reportNode).toHaveCount(1, { timeout: 10_000 });
  await expect(reportNode).toContainText(/Building collapsed/);
  await expect(
    page.getByTestId('graph-node-incident').filter({ hasText: 'Playa Grande, Catia La Mar' }),
  ).toBeVisible();
  await expect(
    page.getByTestId('graph-node-dispatch').filter({ hasText: /Excavator/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId('graph-node-resource').filter({ hasText: /Excavator/ }),
  ).toBeVisible();

  // Clicking the report node opens the inspector with its linked incident.
  await reportNode.first().click();
  const inspector = page.getByTestId('graph-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/Building collapsed/);
  await expect(inspector).toContainText('Linked Incident');
  await expect(inspector).toContainText('Playa Grande, Catia La Mar');
});
