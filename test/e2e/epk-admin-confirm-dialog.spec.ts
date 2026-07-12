import { expect, test } from '@playwright/test';

test('EPK admin clear-log confirm dialog is structured and styled', async ({ page }) => {
  await page.goto('/admin/admin.html', { waitUntil: 'load' });
  await page.evaluate(() => {
    void (window as typeof window & { clearAdminPrintLog: () => Promise<boolean> }).clearAdminPrintLog();
  });

  const overlay = page.locator('#publisher-confirm-dialog');
  await expect(overlay).toHaveCount(1);

  const dialog = overlay.getByRole('dialog');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('heading')).toHaveText('Clear link log');
  await expect(dialog.locator('.kicker')).toHaveCount(1);
  await expect(dialog.locator('p.help')).toHaveCount(1);

  const actions = dialog.locator('.action-list');
  await expect(actions).toHaveCount(1);
  await expect(actions.locator('button')).toHaveCount(2);

  await expect(dialog.locator('.kicker')).toHaveCSS('text-transform', 'uppercase');
  await expect(actions).toHaveCSS('display', 'flex');
  await expect(actions).toHaveCSS('justify-content', 'flex-end');

  const confirmButton = actions.getByRole('button', { name: 'Clear log' });
  await expect(confirmButton).toHaveClass(/(?:^|\s)btn-danger(?:\s|$)/);
  await expect(confirmButton).toHaveCSS('color', 'rgb(196, 122, 122)');

  await actions.getByRole('button', { name: 'Cancel' }).click();
  await expect(overlay).toHaveCount(0);
});
