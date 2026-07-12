import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench mounts and boots Focus', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const focusMount = page.locator('.nav button[data-view="focus"]');

  await expect(focusMount).toBeVisible();
  await expect(focusMount).toHaveCount(1);
  await expect(focusMount.locator('small')).toHaveCount(0);

  await focusMount.click();

  const focusSection = page.locator('section[data-section="focus"]');
  await expect(focusSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  const focusFrame = page.frameLocator('section[data-section="focus"] iframe');
  await expect.poll(() => focusFrame.locator('head').evaluate(() => document.title)).toBe('prism-focus');
  await expect(focusFrame.locator('#root > *').first()).toBeAttached();
});
