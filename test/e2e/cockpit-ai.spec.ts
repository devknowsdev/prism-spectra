import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench renders the read-only AI provider status view', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const aiNav = page.locator('.nav button[data-view="ai"]');

  await expect(aiNav).toBeVisible();
  await expect(aiNav.locator('small')).toHaveCount(0);

  await aiNav.click();

  const aiSection = page.locator('section[data-section="ai"]');
  await expect(aiSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(aiSection.locator('[data-ai-group="local"]')).toContainText('Local');
  await expect(aiSection.locator('[data-ai-group="cloud"]')).toContainText('Cloud');

  for (const provider of ['ollama', 'anthropic', 'openai']) {
    const providerCard = aiSection.locator(`[data-ai-provider="${provider}"]`);
    await expect(providerCard).toBeVisible();
    await expect(providerCard.locator('[data-ai-availability]')).toHaveCount(1);
  }
});
