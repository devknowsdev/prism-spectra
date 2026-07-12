import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench sends a local-first console prompt and renders route provenance', async ({ page }) => {
  await page.route('**/api/v1/ai/request', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen2.5',
        dataBoundary: 'local',
        response: 'Hello from the local model.',
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 1, tokensOut: 5, cost: 0, latencyMs: 42 },
      }),
    });
  });

  await page.goto('/workbench', { waitUntil: 'load' });

  const consoleNav = page.locator('.nav button[data-view="console"]');

  await expect(consoleNav).toBeVisible();
  await expect(consoleNav.locator('small')).toHaveCount(0);

  await consoleNav.click();

  const consoleSection = page.locator('section[data-section="console"]');
  await expect(consoleSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  await consoleSection.locator('#console-prompt').fill('Say hello from local.');
  await consoleSection.locator('#console-send').click();

  await expect(consoleSection.locator('#console-response')).toContainText('Hello from the local model.');
  await expect(consoleSection.locator('#console-route')).toContainText('ollama');
  await expect(consoleSection.locator('#console-route')).toContainText('local');
  await expect(consoleSection.locator('#console-route')).toContainText('42ms');
});
