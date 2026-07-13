import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

test.describe('Workbench mounted navigation overflow', () => {
  test.use({
    viewport: {
      width: 1100,
      height: 520,
    },
  });

  test('left navigation owns vertical overflow and mounted entries remain reachable', async ({ page }) => {
    await page.goto('/workbench', { waitUntil: 'load' });

    const nav = page.locator('.nav');
    const publisherMount = page.locator('.nav button[data-view="epk-publisher"]');
    const adminMount = page.locator('.nav button[data-view="epk-admin"]');
    const focusMount = page.locator('.nav button[data-view="focus"]');

    await expect(publisherMount).toHaveCount(1);
    await expect(adminMount).toHaveCount(1);
    await expect(focusMount).toHaveCount(1);

    await expect.poll(() => nav.evaluate((element) => getComputedStyle(element).overflowY)).toMatch(/^(auto|scroll)$/);
    await expect.poll(() => nav.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toMatch(/^(auto|scroll)$/);

    const lastEntryStartsBeyondInitialNavArea = await focusMount.evaluate((button, navElement) => {
      const buttonRect = button.getBoundingClientRect();
      const navRect = (navElement as Element).getBoundingClientRect();
      return buttonRect.bottom > navRect.bottom || buttonRect.top < navRect.top;
    }, await nav.elementHandle());
    expect(lastEntryStartsBeyondInitialNavArea).toBe(true);

    await nav.hover();
    const before = await nav.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);

    await expect(focusMount).toBeInViewport();
    await focusMount.click();

    const focusSection = page.locator('section[data-section="focus"]');
    await expect(focusSection).toHaveClass(/(?:^|\s)active(?:\s|$)/);

    const focusFrame = page.frameLocator('section[data-section="focus"] iframe');
    await expect.poll(() => focusFrame.locator('head').evaluate(() => document.title)).toBe('prism-focus');
    await expect(page.locator('section[data-section="focus"] button[data-surface-action="inspect"]')).toBeVisible();

    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.nav button[data-view="epk-publisher"]')).toHaveCount(1);
    await expect(page.locator('.nav button[data-view="epk-admin"]')).toHaveCount(1);
    await expect(page.locator('.nav button[data-view="focus"]')).toHaveCount(1);
    await expect.poll(() => page.locator('.nav').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  });
});

test.describe('Workbench normal-height rail layout', () => {
  test.use({
    viewport: {
      width: 1280,
      height: 900,
    },
  });

  test('footer stays visible, nav avoids horizontal overflow, and mounted entries remain selectable', async ({ page }) => {
    await page.goto('/workbench', { waitUntil: 'load' });

    const rail = page.locator('.rail');
    const nav = page.locator('.nav');
    const footer = page.locator('.rail-footer');
    const focusMount = page.locator('.nav button[data-view="focus"]');

    await expect(footer).toBeVisible();
    await expect.poll(() => nav.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect.poll(() => rail.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.round(rect.height);
    })).toBe(900);

    await focusMount.click();
    await expect(page.locator('section[data-section="focus"]')).toHaveClass(/(?:^|\s)active(?:\s|$)/);
    await expect.poll(() => page.frameLocator('section[data-section="focus"] iframe').locator('head').evaluate(() => document.title)).toBe('prism-focus');
  });
});
