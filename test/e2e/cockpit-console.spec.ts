import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test('Workbench sends a local-only console prompt and renders route provenance', async ({ page }) => {
  let requestBody: Record<string, any> | null = null;
  let requestToken: string | undefined;
  await page.route('**/api/v1/ai/request', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, any>;
    requestToken = route.request().headers()['x-local-token'];
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

  expect(requestBody).toMatchObject({
    sourceApp: 'prism-spectra',
    intent: 'workbench-chat',
    preferredMode: 'local-only',
    input: { prompt: 'Say hello from local.' },
  });
  expect(requestToken).toBeTruthy();
  await expect(consoleSection.locator('#console-response')).toContainText('Hello from the local model.');
  await expect(consoleSection.locator('#console-route')).toContainText('ollama');
  await expect(consoleSection.locator('#console-route')).toContainText('local');
  await expect(consoleSection.locator('#console-route')).toContainText('42ms');
});

test('Workbench injects a runtime token for the daemon AI request endpoint', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });

  const authResults = await page.evaluate(async () => {
    const missing = await fetch('/api/v1/ai/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const wrong = await fetch('/api/v1/ai/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-local-token': 'wrong-token' },
      body: JSON.stringify({}),
    });
    const token = (window as any).__SPECTRA_LOCAL_TOKEN;
    const injected = await fetch('/api/v1/ai/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-local-token': token },
      body: JSON.stringify({}),
    });
    const injectedBody = await injected.json();
    return {
      hasToken: typeof token === 'string' && token.length > 0,
      missing: missing.status,
      wrong: wrong.status,
      injected: injected.status,
      injectedError: injectedBody?.error,
    };
  });

  expect(authResults.hasToken).toBe(true);
  expect(authResults.missing).toBe(401);
  expect(authResults.wrong).toBe(401);
  expect(authResults.injected).toBe(400);
  expect(authResults.injectedError).toMatch(/sourceApp|expected JSON body/);
});
