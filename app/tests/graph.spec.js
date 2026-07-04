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

  test('clicking an incident node opens the relationship inspector', async ({ page }) => {
    await openGraph(page);

    await page.getByTestId('graph-node-incident').first().click();
    const inspector = page.getByRole('dialog', { name: 'Graph relationship inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Field Reports');
    await expect(inspector).toContainText('Dispatches & Resources');
    await expect(inspector).toContainText('People');
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
  });

  test('graph nodes are keyboard inspectable', async ({ page }) => {
    await openGraph(page);

    await page.getByTestId('graph-node-incident').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Graph relationship inspector' })).toBeVisible();
  });
});
