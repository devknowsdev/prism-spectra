import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench renders the read-only Git status view', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const gitNav = page.locator('.nav button[data-view="git"]');

  await expect(gitNav).toBeVisible();
  await expect(gitNav.locator('small')).toHaveCount(0);

  await gitNav.click();

  const gitSection = page.locator('section[data-section="git"]');
  await expect(gitSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  const spectraRepo = gitSection.locator('[data-git-repo="prism-spectra"]');
  await expect(spectraRepo).toBeVisible();
  await expect(spectraRepo.locator('[data-git-branch]')).not.toHaveText('unknown');
});
