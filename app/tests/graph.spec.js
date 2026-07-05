import { expect, test } from '@playwright/test';

async function openGraph(page) {
  await page.goto('/graph');
  await expect(page.getByText('Node Graph Command')).toBeVisible();
  await expect(page.getByTestId('graph-node-incident').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('graph command interface', () => {
  test('renders live-style graph relationships in mock mode', async ({ page }) => {
    await openGraph(page);

    await expect(page.getByText('Gemma local brain')).toBeVisible();
    await expect(page.getByTestId('graph-node-incident')).toHaveCount(3);
    await expect(page.getByTestId('graph-node-report')).toHaveCount(4);
    await expect(page.getByTestId('graph-node-dispatch')).toHaveCount(2);
    await expect(page.getByTestId('graph-node-resource')).toHaveCount(3);
    await expect(page.getByTestId('graph-node-person')).toHaveCount(2);
    await expect(page.getByText(/Edificio colapsado/i)).toBeVisible();
    await expect(page.getByText('Maria Lopez')).toBeVisible();
  });

  test('surfaces pending approvals without requiring graph discovery', async ({ page }) => {
    await openGraph(page);

    const queue = page.getByRole('region', { name: 'Dispatch approvals' });
    await expect(queue).toBeVisible();
    await expect(queue).toContainText('ACTION REQUIRED');
    await expect(queue).toContainText('2 dispatches awaiting approval');

    await queue.getByRole('button', { name: /Review dispatch for/i }).first().click();
    const inspector = page.getByRole('dialog', { name: 'Graph relationship inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Confirm dispatch' })).toBeVisible();

    await inspector.getByRole('button', { name: 'Confirm dispatch' }).click();
    await expect(queue).toContainText('1 dispatch awaiting approval');
  });

  test('clicking an incident node opens the relationship inspector', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await openGraph(page);

    await page.getByTestId('graph-node-incident').first().click();
    const inspector = page.getByRole('dialog', { name: 'Graph relationship inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Field Reports');
    await expect(inspector).toContainText('Dispatches & Resources');
    await expect(inspector).toContainText('People');

    const viewport = page.viewportSize();
    await expect
      .poll(async () => {
        const drawerBox = await inspector.boundingBox();
        return Math.round((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0));
      })
      .toBe(viewport?.width);
    await expect
      .poll(async () => {
        const drawerBox = await inspector.boundingBox();
        return drawerBox?.x ?? 0;
      })
      .toBeGreaterThan(0);

    const drawerBody = inspector.locator('.cmd-drawer__body');
    await expect
      .poll(async () => drawerBody.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await drawerBody.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(async () => drawerBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    // Focus lands on the close control when the inspector opens.
    await expect(inspector.getByRole('button', { name: 'Close graph inspector' })).toBeFocused();

    // Escape closes the inspector.
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });

  test('clicking report, dispatch, resource, and person nodes opens connected context', async ({ page }) => {
    await openGraph(page);

    await page.getByTestId('graph-node-report').first().click();
    await expect(page.getByTestId('graph-inspector')).toContainText('Linked Incident');
    await expect(page.getByTestId('graph-inspector')).toContainText(/Edificio colapsado/i);

    await page.getByRole('button', { name: 'Close graph inspector' }).click();
    await page.getByTestId('graph-node-dispatch').first().click();
    await expect(page.getByTestId('graph-inspector')).toContainText(/nearest heavy machinery/i);

    await page.getByRole('button', { name: 'Close graph inspector' }).click();
    await page.getByTestId('graph-node-resource').first().click();
    await expect(page.getByTestId('graph-inspector')).toContainText('Dispatches & Resources');

    await page.getByRole('button', { name: 'Close graph inspector' }).click();
    await page.getByTestId('graph-node-person').first().click();
    await expect(page.getByTestId('graph-inspector')).toContainText('Maria Lopez');
    await expect(page.getByTestId('graph-inspector')).toContainText('Linked Incident');
  });

  test('clicking an alert node opens alert context', async ({ page }) => {
    await openGraph(page);

    await page.getByRole('button', { name: /^(Broadcast alert|Alert)$/i }).click();
    const modal = page.getByRole('dialog', { name: 'Broadcast Alert' });
    await modal.getByPlaceholder(/Tsunami warning/i).fill('Aftershock warning near Playa Grande');
    await modal.locator('select').selectOption('critical');
    await modal.getByPlaceholder(/Catia La Mar/i).fill('Playa Grande');
    await modal.getByRole('button', { name: 'Send Alert' }).click();

    await expect(page.getByTestId('graph-node-alert')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('graph-node-alert').first().click();
    await expect(page.getByTestId('graph-inspector')).toContainText('Aftershock warning near Playa Grande');
    await expect(page.getByTestId('graph-inspector')).toContainText('Alerts');

    // Deactivating the alert closes the inspector and removes the node.
    await page.getByRole('button', { name: 'Deactivate alert' }).click();
    await expect(page.getByTestId('graph-inspector')).toBeHidden();
    await expect(page.getByTestId('graph-node-alert')).toHaveCount(0);
  });

  test('graph filters change the visible nodes and the legend is present', async ({ page }) => {
    await openGraph(page);

    const filters = page.getByRole('group', { name: 'Graph filters' });
    await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await filters.getByRole('button', { name: 'Critical only' }).click();
    await expect(filters.getByRole('button', { name: 'Critical only' })).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('graph-node-incident')).toHaveCount(1);
    await expect(page.getByTestId('graph-node-report')).toHaveCount(2);
    await expect(page.getByTestId('graph-node-dispatch')).toHaveCount(1);
    await expect(page.getByTestId('graph-node-resource')).toHaveCount(1);
    await expect(page.getByTestId('graph-node-person')).toHaveCount(1);

    await filters.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByTestId('graph-node-person')).toHaveCount(2);
    await expect(page.getByTestId('graph-node-incident')).toHaveCount(2);
    await expect(page.getByTestId('graph-node-dispatch')).toHaveCount(0);
    await expect(page.getByTestId('graph-node-resource')).toHaveCount(0);

    await filters.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByTestId('graph-node-incident')).toHaveCount(3);
    await expect(page.getByTestId('graph-node-report')).toHaveCount(4);

    const legend = page.locator('.cmd-graph-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Edge colors');
    await expect(legend).toContainText('Report evidence');
    await expect(legend).toContainText('Gemma / AI');
    await expect(legend).toContainText('Dispatch / resource');
    await expect(legend).toContainText('Critical re-match loop');
  });

  test('dispatch override reassigns the proposed resource from the inspector', async ({ page }) => {
    await openGraph(page);

    await page.getByTestId('graph-node-dispatch').first().click();
    const inspector = page.getByTestId('graph-inspector');
    await expect(inspector).toContainText(/nearest heavy machinery/i);

    await inspector.getByRole('button', { name: 'Override', exact: true }).click();
    await inspector.locator('#graph-override-resource').selectOption('res-seed-clinic-catia-la-mar');
    await inspector.getByRole('button', { name: 'Confirm override' }).click();

    await expect(inspector).toContainText('Improvised clinic with spare capacity');
    await expect(inspector).toContainText('Confirmed');
    await expect(inspector).toContainText('Coordinator override');
  });

  test('graph topbar actions still work', async ({ page }) => {
    await openGraph(page);
    const topbar = page.locator('.cmd-topbar__actions');

    // Map overlay
    await topbar.getByRole('button', { name: 'Open compact map' }).click();
    const map = page.getByRole('dialog', { name: 'Incident map' });
    await expect(map).toBeVisible();
    await map.getByRole('button', { name: 'Close map' }).click();
    await expect(map).toBeHidden();

    // Alert composer
    await topbar.getByRole('button', { name: 'Broadcast alert' }).click();
    const composer = page.getByRole('dialog', { name: 'Broadcast Alert' });
    await expect(composer).toBeVisible();
    await composer.getByRole('button', { name: 'Close broadcast alert' }).click();
    await expect(composer).toBeHidden();

    // SITREP modal
    await topbar.getByRole('button', { name: 'SITREP' }).click();
    const sitrep = page.getByRole('dialog', { name: 'Situation report' });
    await expect(sitrep).toBeVisible();
    await expect(sitrep).toContainText('SITREP — Situation Report');
    await sitrep.getByRole('button', { name: 'Close' }).click();
    await expect(sitrep).toBeHidden();

    // Gemma chat panel (opened from the Gemma brain node)
    await page.getByRole('button', { name: 'Ask Gemma' }).click();
    const chat = page.getByRole('complementary', { name: 'Gemma chat panel' });
    await expect(chat).toBeVisible();
    await chat.getByRole('button', { name: 'Close Gemma chat' }).click();
    await expect(chat).toBeHidden();

    // Sync now (inside command settings) keeps the sync indicator healthy
    await topbar.getByRole('button', { name: 'Command post settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Command post settings' });
    await settings.getByRole('button', { name: /Sync now/i }).click();
    await expect(page.locator('.cmd-sync')).toContainText(/synced \d+s ago/);
  });

  test('graph exposes the shared command settings', async ({ page }) => {
    await openGraph(page);

    await page.getByRole('button', { name: 'Command post settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Command post settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Connect a field phone')).toBeVisible();
    await expect(settings.getByText('Offline maps')).toBeVisible();
    await expect(settings.getByText('Sync now')).toBeVisible();
  });

  test('Gemma chat proposes node changes the operator can apply', async ({ page }) => {
    await openGraph(page);

    await page.getByRole('button', { name: 'Ask Gemma' }).click();
    const chat = page.getByRole('complementary', { name: 'Gemma chat panel' });
    await expect(chat).toBeVisible();

    await chat
      .getByLabel('Ask Gemma about current decisions')
      .fill('Escalate the shelter water situation to critical and broadcast an aftershock alert');
    await chat.getByRole('button', { name: 'Ask' }).click();

    const actions = chat.getByTestId('chat-proposed-action');
    await expect(actions).toHaveCount(2, { timeout: 10_000 });
    await expect(actions.first()).toContainText('Edit situation node');
    await expect(actions.first()).toContainText('urgency → critical');
    await expect(actions.last()).toContainText('Add alert node');

    // Dismiss works without touching the board.
    await actions.last().getByRole('button', { name: 'Dismiss' }).click();
    await expect(actions).toHaveCount(1);
    await expect(page.getByTestId('graph-node-alert')).toHaveCount(0);

    // Applying the escalation goes through PATCH /api/incidents/:id and the
    // graph picks it up on the next sync poll.
    await actions.first().getByRole('button', { name: 'Apply' }).click();
    await expect(actions.first()).toContainText('Applied', { timeout: 10_000 });

    await chat.getByRole('button', { name: 'Close Gemma chat' }).click();
    const filters = page.getByRole('group', { name: 'Graph filters' });
    await filters.getByRole('button', { name: 'Critical only' }).click();
    await expect(page.getByTestId('graph-node-incident')).toHaveCount(2, { timeout: 15_000 });
  });

  test('graph nodes are keyboard inspectable', async ({ page }) => {
    await openGraph(page);

    await page.getByTestId('graph-node-incident').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Graph relationship inspector' })).toBeVisible();
  });
});
