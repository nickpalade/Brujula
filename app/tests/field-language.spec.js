import { test, expect } from '@playwright/test';

// Field client runs in offline mock mode (VITE_USE_MOCKS=true from
// playwright.config.js). Fresh contexts have empty localStorage, so the app
// starts on the Onboarding screen in the default language (Spanish).

test.beforeEach(async ({ page }) => {
  await page.goto('/field');
});

test('first launch opens onboarding in Spanish and asks for language', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Bienvenido a Brújula' })).toBeVisible();
  // Language is the first thing asked.
  const langSelect = page.getByLabel('Idioma / Language');
  await expect(langSelect).toBeVisible();
  await expect(langSelect).toHaveValue('es');
  // Role cards are in Spanish.
  await expect(page.getByText('Reportero')).toBeVisible();
  await expect(page.getByText('Equipo especializado')).toBeVisible();
});

test('choosing English translates the onboarding instantly', async ({ page }) => {
  const langSelect = page.getByLabel('Idioma / Language');
  await langSelect.selectOption('en');

  // The whole screen re-renders in English with no reload.
  await expect(page.getByRole('heading', { name: 'Welcome to Brújula' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who are you in the field?' })).toBeVisible();
  await expect(page.getByText('Reporter')).toBeVisible();
  await expect(page.getByText('Specialized crew')).toBeVisible();

  // Switching back to Spanish is just as instant.
  await langSelect.selectOption('es');
  await expect(page.getByRole('heading', { name: 'Bienvenido a Brújula' })).toBeVisible();
});

test('language choice persists across reload', async ({ page }) => {
  await page.getByLabel('Idioma / Language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Welcome to Brújula' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to Brújula' })).toBeVisible();
  await expect(page.getByLabel('Idioma / Language')).toHaveValue('en');
});

test('completing onboarding in English shows an English report screen', async ({ page }) => {
  await page.getByLabel('Idioma / Language').selectOption('en');

  // Pick the reporter role, enter a name, and start.
  await page.getByText('Reporter', { exact: true }).click();
  await page.getByLabel('Your name').fill('Maria P.');
  await page.getByRole('button', { name: 'Start' }).click();

  // Field report screen is in English.
  await expect(page.getByRole('heading', { name: 'Brújula · Field' })).toBeVisible();
  await expect(page.getByText("What's happening?")).toBeVisible();
  await expect(page.getByText('Category')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeVisible();
});

test('settings gear switches the display language after onboarding', async ({ page }) => {
  // Complete onboarding in Spanish (the default) as a reporter.
  await page.getByText('Reportero', { exact: true }).click();
  await page.getByLabel('Tu nombre').fill('María P.');
  await page.getByRole('button', { name: 'Comenzar' }).click();

  // Report screen is Spanish; no language picker is inline in the header.
  await expect(page.getByText('¿Qué está pasando?')).toBeVisible();

  // Open the settings menu via the gear icon and switch to English.
  const gear = page.getByRole('button', { name: 'Ajustes' });
  await expect(gear).toBeVisible();
  await gear.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: /English/ }).click();

  // The whole field UI re-renders in English, and the menu closes.
  await expect(page.getByText("What's happening?")).toBeVisible();
  await expect(page.getByRole('menu')).toBeHidden();

  // Choice persists across reload.
  await page.reload();
  await expect(page.getByText("What's happening?")).toBeVisible();

  // Reopen the menu — English is marked as the active choice.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('menuitemradio', { name: /English/ }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('submitting a report shows a localized confirmation toast', async ({ page }) => {
  await page.getByLabel('Idioma / Language').selectOption('en');
  await page.getByText('Reporter', { exact: true }).click();
  await page.getByLabel('Your name').fill('Maria P.');
  await page.getByRole('button', { name: 'Start' }).click();

  await page.getByPlaceholder(/Building collapsed in Playa Grande/).fill('Test report from Playwright');
  await page.getByRole('button', { name: 'Send report' }).click();

  await expect(page.getByText('Report saved — it will be sent to the hub')).toBeVisible();
  // The queued report renders with the English status label.
  await expect(page.getByText('My reports')).toBeVisible();
});
