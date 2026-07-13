import { expect, type Page, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

const blockedInitialEndpoints = [
  '/api/v1/workbench/conversations',
  '/api/v1/workbench/attachments',
  '/api/v1/git/status',
  '/api/v1/capabilities/manifests',
  '/api/v1/preview/apps',
];

async function waitForProjectHome(page: Page) {
  await expect(page.locator('section[data-section="project-home"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(page.locator('[data-project-home-widget]')).toHaveCount(3);
  await expect(page.locator('[data-project-home-widget][data-widget-state="loading"]')).toHaveCount(0);
}

test('Project Home is the default, renders widgets, stays lazy, and links to detail views', async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) requestedPaths.push(url.pathname);
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await waitForProjectHome(page);

  await expect(page.locator('.nav button[data-view="project-home"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#title')).toHaveText('Project Home');
  await expect(page.locator('section[data-section="project-home"]')).toContainText('where the project stands and what needs attention');
  await expect(page.locator('[data-project-home-widget="current-phase"]')).toContainText('Current phase');
  await expect(page.locator('[data-project-home-widget="decisions-needed"]')).toContainText('Decisions needed');
  await expect(page.locator('[data-project-home-widget="ai-availability"]')).toContainText('AI availability');

  for (const endpoint of blockedInitialEndpoints) {
    expect(requestedPaths).not.toContain(endpoint);
  }

  await page.locator('[data-project-home-widget="current-phase"] button[data-project-home-detail="roadmap"]').click();
  await expect(page.locator('section[data-section="roadmap"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  await page.locator('.nav button[data-view="project-home"]').click();
  await page.locator('[data-project-home-widget="decisions-needed"] button[data-project-home-detail="approvals"]').click();
  await expect(page.locator('section[data-section="approvals"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  await page.locator('.nav button[data-view="project-home"]').click();
  await page.locator('[data-project-home-widget="ai-availability"] button[data-project-home-detail="ai"]').click();
  await expect(page.locator('section[data-section="ai"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
});

test('a failed roadmap endpoint degrades only the Current phase widget', async ({ page }) => {
  await page.route('**/api/v1/roadmap', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'roadmap unavailable' }) });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await waitForProjectHome(page);

  await expect(page.locator('[data-project-home-widget="current-phase"]')).toHaveAttribute('data-widget-state', 'transient_failure');
  await expect(page.locator('[data-project-home-widget="decisions-needed"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await expect(page.locator('[data-project-home-widget="ai-availability"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await page.locator('.nav button[data-view="resume"]').click();
  await expect(page.locator('section[data-section="resume"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
});

test('a failed approvals endpoint degrades only the Decisions needed widget', async ({ page }) => {
  await page.route('**/api/v1/workbench/approvals', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'approval queue unavailable' }) });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await waitForProjectHome(page);

  await expect(page.locator('[data-project-home-widget="decisions-needed"]')).toHaveAttribute('data-widget-state', 'transient_failure');
  await expect(page.locator('[data-project-home-widget="current-phase"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await expect(page.locator('[data-project-home-widget="ai-availability"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await page.locator('.nav button[data-view="roadmap"]').click();
  await expect(page.locator('section[data-section="roadmap"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
});

test('a failed AI-status endpoint degrades only the AI availability widget', async ({ page }) => {
  await page.route('**/api/v1/ai/status', async (route) => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI status probe failed' }) });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await waitForProjectHome(page);

  await expect(page.locator('[data-project-home-widget="ai-availability"]')).toHaveAttribute('data-widget-state', 'transient_failure');
  await expect(page.locator('[data-project-home-widget="current-phase"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await expect(page.locator('[data-project-home-widget="decisions-needed"]')).not.toHaveAttribute('data-widget-state', /failure|error/);
  await page.locator('.nav button[data-view="settings"]').click();
  await expect(page.locator('section[data-section="settings"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
});

test('#resume still opens the existing view with the Session History label', async ({ page }) => {
  await page.goto('/workbench#resume', { waitUntil: 'load' });

  const resumeNav = page.locator('.nav button[data-view="resume"]');
  await expect(resumeNav).toContainText('Session History');
  await expect(resumeNav).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('section[data-section="resume"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(page.locator('#title')).toHaveText('Session History');
});
