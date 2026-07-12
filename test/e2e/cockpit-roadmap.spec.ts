import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench renders the read-only Roadmap view', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const roadmapNav = page.locator('.nav button[data-view="roadmap"]');

  await expect(roadmapNav).toBeVisible();
  await expect(roadmapNav.locator('small')).toHaveCount(0);

  await roadmapNav.click();

  const roadmapSection = page.locator('section[data-section="roadmap"]');
  await expect(roadmapSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(roadmapSection.getByText('Mount apps into the cockpit')).toBeVisible();
  await expect(roadmapSection.locator('[data-roadmap-status="current"]')).toHaveCount(1);
});
