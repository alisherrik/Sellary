import { test, expect } from '@playwright/test';

test.describe('Offline Mode & Sync', () => {
    test('should detect offline status', async ({ page }) => {
        // Go to dashboard
        await page.goto('http://localhost:3000/dashboard');

        // Simulate offline
        await page.context().setOffline(true);

        // Check network status indicator in header
        await expect(page.getByText('Offline')).toBeVisible({ timeout: 10000 });
    });

    test('settings page should show sync controls', async ({ page }) => {
        await page.goto('http://localhost:3000/settings');

        // Check for Sync section
        await expect(page.getByText('Синхронизация', { exact: true })).toBeVisible();

        // Check sync button
        await expect(page.getByRole('button', { name: /Синхронизировать/i })).toBeVisible();
    });
});
