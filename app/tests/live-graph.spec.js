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
  await hub(request, '/api/register', {
    method: 'POST',
    data: {
      role: 'crew',
      name: 'Live Excavator Crew',
      skill: 'machinery',
      location: 'Caraballeda',
      team_size: 5,
      device_id: 'live-excavator-graph',
    },
  });
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
    page.getByTestId('graph-node-dispatch').filter({ hasText: /Live Excavator Crew/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId('graph-node-resource').filter({ hasText: /Live Excavator Crew/ }),
  ).toBeVisible();

  // Clicking the report node opens the inspector with its linked incident.
  await reportNode.first().click();
  const inspector = page.getByTestId('graph-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/Building collapsed/);
  await expect(inspector).toContainText('Linked Incident');
  await expect(inspector).toContainText('Playa Grande, Catia La Mar');
});

test('a crew arriving after an unmatched incident creates a proposal that command can confirm', async ({ page, request }) => {
  const incident = await hub(request, '/api/incidents', {
    method: 'POST',
    data: {
      kind: 'need',
      category: 'rescue',
      location: 'Late Resource Test Site',
      people_count: 8,
      urgency: 'critical',
      summary: 'Eight people trapped and awaiting a rescue crew.',
    },
  });

  const before = await hub(request, '/api/sync?since=0');
  expect(before.dispatches.some((dispatch) => dispatch.incident_id === incident.id)).toBe(false);

  const registration = await hub(request, '/api/register', {
    method: 'POST',
    data: {
      role: 'crew',
      name: 'Late Rescue Crew',
      skill: 'rescue',
      location: 'Caraballeda',
      team_size: 6,
      device_id: 'late-live-rescue',
    },
  });

  const dispatch = registration.proposed_dispatches.find((item) => item.incident_id === incident.id);
  expect(dispatch).toBeTruthy();
  expect(dispatch.resource_id).toBe(registration.resource.id);

  await page.goto('/graph');
  await expect(page.getByText('Node Graph Command')).toBeVisible();
  const dispatchNode = page.getByTestId('graph-node-dispatch').filter({ hasText: 'Late Rescue Crew' });
  await expect(dispatchNode).toBeVisible({ timeout: 10_000 });
  await dispatchNode.click();

  const inspector = page.getByTestId('graph-inspector');
  await expect(inspector).toContainText('Late Resource Test Site');
  await inspector.getByRole('button', { name: 'Confirm dispatch' }).click();
  await expect(inspector).toContainText('Confirmed', { timeout: 10_000 });

  const confirmed = await hub(request, '/api/sync?since=0');
  expect(confirmed.dispatches.find((item) => item.id === dispatch.id)?.state).toBe('confirmed');
  expect(confirmed.resources.find((item) => item.id === registration.resource.id)?.status).toBe('committed');
});
