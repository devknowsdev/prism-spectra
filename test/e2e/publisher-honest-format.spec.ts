import { expect, test } from '@playwright/test';

test('EPK Publisher Format pretty-prints without applying', async ({ page }) => {
  await page.goto('/publisher/index.html', { waitUntil: 'load' });

  const status = page.locator('#status');
  const jsonBox = page.locator('#json-box');

  await expect(status).not.toContainText('Loading');
  await expect(jsonBox).toHaveValue(/\S/);

  await page.evaluate(() => {
    const showPage = (window as typeof window & { showPage?: (id: string) => void }).showPage;
    if (!showPage) throw new Error('Missing Publisher showPage');

    showPage('json');
  });
  await expect(page.locator('#page-json')).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  await page.evaluate(() => {
    localStorage.removeItem('epk-publisher-draft');
  });

  await page.evaluate(() => {
    const box = document.getElementById('json-box') as HTMLTextAreaElement | null;
    if (!box) throw new Error('Missing #json-box');

    const data = JSON.parse(box.value);
    data.credits = [];
    data.gallery = [];
    data.offerings = [];
    data.releases = [];
    data.videos = [];
    box.value = JSON.stringify(data);
  });

  await page.locator('#format-json-btn').click();

  const formattedJson = await jsonBox.inputValue();
  expect(formattedJson).toContain('\n');
  expect(formattedJson).toMatch(/\n {2}"/);
  await expect(status).toHaveText('JSON formatted.');

  await page.waitForTimeout(650);
  await expect(page.evaluate(() => localStorage.getItem('epk-publisher-draft'))).resolves.toBeNull();

  await page.locator('#apply-json-btn').click();
  await expect(status).toHaveText('JSON applied to the visual editor.');

  await page.waitForTimeout(650);
  await expect(page.evaluate(() => localStorage.getItem('epk-publisher-draft'))).resolves.not.toBeNull();
});
