import { test, expect } from '@playwright/test'

test('command post fits a standard operations laptop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/command')
  await expect(page.getByText('Prioritized Action Feed')).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator('.cmd-feed')).toBeInViewport()
  await expect(page.locator('.cmd-rail')).toBeInViewport()

  const resources = page.getByText('Resource Inventory')
  await resources.scrollIntoViewIfNeeded()
  await expect(resources).toBeInViewport()

  const firstIncident = page.locator('.cmd-incident').first()
  await firstIncident.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Incident detail' })).toBeVisible()
  await page.screenshot({ path: 'test-results/usability-command.png', fullPage: true })
})

test('every command pane can open fullscreen and close with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto('/command')

  const panels = page.locator('.cmd-main .bru-panel')
  await expect(panels).toHaveCount(6)

  for (const panel of await panels.all()) {
    const title = (await panel.getAttribute('aria-label')) || 'panel'
    await panel.getByRole('button', { name: `Open fullscreen: ${title}` }).click()
    await expect(panel).toHaveClass(/bru-panel--expanded/)
    await expect(panel).toHaveCSS('position', 'fixed')
    await page.keyboard.press('Escape')
    await expect(panel).not.toHaveClass(/bru-panel--expanded/)
  }
})

test('incident detail panels expand to their content instead of clipping', async ({ page }) => {
  await page.setViewportSize({ width: 692, height: 949 })
  await page.goto('/command')
  await page.locator('.cmd-incident').first().click()

  const drawer = page.getByRole('dialog', { name: 'Incident detail' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toHaveCSS('width', '692px')

  for (const panel of await drawer.locator('.bru-panel').all()) {
    const dimensions = await panel.evaluate((element) => ({
      clientHeight: element.querySelector('.bru-panel__body')?.clientHeight ?? 0,
      scrollHeight: element.querySelector('.bru-panel__body')?.scrollHeight ?? 0,
    }))
    expect(dimensions.clientHeight).toBe(dimensions.scrollHeight)
  }
})

test('field report keeps touch controls usable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/field')
  await page.getByLabel('Idioma / Language').selectOption('en')
  await page.getByText('Reporter', { exact: true }).click()
  await page.getByLabel('Your name').fill('Field responder')
  await page.getByRole('button', { name: 'Start' }).click()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  for (const control of await page.locator('button:visible').all()) {
    const box = await control.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  await expect(page.getByRole('heading', { name: 'Brújula · Field' })).toHaveCSS(
    'white-space',
    'nowrap',
  )

  await page.screenshot({ path: 'test-results/usability-field.png', fullPage: true })
})
