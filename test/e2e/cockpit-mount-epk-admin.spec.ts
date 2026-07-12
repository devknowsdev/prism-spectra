import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench mounts and boots EPK Admin', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const publisherMount = page.locator('.nav button[data-view="epk-publisher"]');
  const adminMount = page.locator('.nav button[data-view="epk-admin"]');

  await expect(adminMount).toBeVisible();
  await expect(publisherMount).toHaveCount(1);
  await expect(adminMount).toHaveCount(1);

  await adminMount.click();

  const adminSection = page.locator('section[data-section="epk-admin"]');
  await expect(adminSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  const adminFrame = page.frameLocator('section[data-section="epk-admin"] iframe');
  await expect(adminFrame.locator('.brand')).toContainText('EPK OS');
});
