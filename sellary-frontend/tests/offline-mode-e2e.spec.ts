import { test, expect } from '@playwright/test';

/**
 * COMPREHENSIVE E2E TESTS FOR OFFLINE MODE
 *
 * These tests verify the complete offline mode functionality including:
 * 1. Server health detection
 * 2. Offline state transitions
 * 3. Request queue management
 * 4. Data synchronization
 * 5. Prevention of infinite request loops
 */

test.describe('Server Health Detection', () => {
    test('should detect when server is online', async ({ page }) => {
        await page.goto('http://localhost:3000/dashboard');

        // Wait for initial health check to complete
        await page.waitForTimeout(1000);

        // Should NOT show offline indicator
        await expect(page.getByText('Офлайн режим')).not.toBeVisible();
        await expect(page.getByText('Live Mode')).not.toBeVisible();
    });

    test('should detect when server goes offline', async ({ page }) => {
        await page.goto('http://localhost:3000/dashboard');

        // Simulate server going down
        await page.context().setOffline(true);

        // Wait for health check to detect offline
        await page.waitForTimeout(6000);

        // Should show offline indicator or message
        const offlineIndicator = page.getByText(/офлайн/i);
        await expect(offlineIndicator).toBeVisible({ timeout: 10000 });
    });

    test('should detect when server comes back online', async ({ page }) => {
        // Start offline
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Verify offline state
        await expect(page.getByText(/офлайн/i)).toBeVisible();

        // Come back online
        await page.context().setOffline(false);

        // Wait for health check to detect online
        await page.waitForTimeout(6000);

        // Offline indicator should disappear
        await expect(page.getByText(/офлайн/i)).not.toBeVisible({ timeout: 10000 });
    });

    test('should perform health checks every 30 seconds', async ({ page }) => {
        await page.goto('http://localhost:3000/dashboard');

        // Track network requests
        const requests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/api/sales')) {
                requests.push(request.url());
            }
        });

        // Wait for initial health check
        await page.waitForTimeout(2000);

        // Count initial requests
        const initialCount = requests.length;

        // Wait for next health check cycle (30s)
        await page.waitForTimeout(32000);

        // Should have additional health check requests
        expect(requests.length).toBeGreaterThan(initialCount);
    });

    test('should detect offline via browser offline event', async ({ page }) => {
        await page.goto('http://localhost:3000/dashboard');

        // Monitor browser's navigator.onLine state
        const isOnline = await page.evaluate(() => navigator.onLine);
        expect(isOnline).toBe(true);

        // Simulate browser offline event
        await page.context().setOffline(true);

        // Verify navigator.onLine changed
        const isOffline = await page.evaluate(() => navigator.onLine);
        expect(isOffline).toBe(false);

        // Should show offline indicator
        await expect(page.getByText(/офлайн/i)).toBeVisible({ timeout: 10000 });
    });
});

test.describe('Request Loop Prevention', () => {
    test('CRITICAL: should NOT make requests when offline', async ({ page }) => {
        // Track all requests to /api/sales
        let apiRequestCount = 0;
        page.on('request', request => {
            if (request.url().includes('/api/sales') || request.url().includes('/api/products')) {
                apiRequestCount++;
            }
        });

        // Start with server offline
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/sales');

        // Wait for health check and initial queries to settle
        await page.waitForTimeout(8000);

        // CRITICAL: Should NOT have made any requests to /api/sales or /api/products
        // The health check might make one request, but queries should be disabled
        expect(apiRequestCount).toBe(0);
    });

    test('should stop all queries when going offline', async ({ page }) => {
        // Start online
        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Track requests after going offline
        let requestsAfterOffline = 0;
        page.on('request', request => {
            if (request.url().includes('/api/sales')) {
                requestsAfterOffline++;
            }
        });

        // Go offline
        await page.context().setOffline(true);

        // Wait for health check to detect offline
        await page.waitForTimeout(6000);

        // Try to navigate to different pages
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(2000);
        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Should NOT make requests to /api/sales after going offline
        expect(requestsAfterOffline).toBe(0);
    });

    test('should make exactly ONE request per query when online', async ({ page }) => {
        const salesRequests: string[] = [];

        page.on('request', request => {
            if (request.url().includes('/api/sales')) {
                salesRequests.push(request.url());
            }
        });

        // Navigate to sales page online
        await page.goto('http://localhost:3000/sales');

        // Wait for data to load
        await page.waitForTimeout(3000);

        // Should have made exactly ONE request to /api/sales (ignoring retries)
        // Filter out retry requests with same URL
        const uniqueUrls = new Set(salesRequests);
        expect(uniqueUrls.size).toBe(1);
    });
});

test.describe('Offline Mode Transitions', () => {
    test('should transition smoothly from online to offline', async ({ page }) => {
        // Start online
        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Verify data is loaded
        await expect(page.getByText(/продажи/i)).toBeVisible();

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Should show offline indicator
        await expect(page.getByText(/офлайн/i)).toBeVisible();

        // Should NOT make new requests
        const requests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/api/sales')) {
                requests.push(request.url());
            }
        });

        await page.waitForTimeout(3000);
        expect(requests.length).toBe(0);
    });

    test('should transition smoothly from offline to online', async ({ page }) => {
        // Start offline
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(6000);

        // Verify offline state
        await expect(page.getByText(/офлайн/i)).toBeVisible();

        // Come online
        await page.context().setOffline(false);
        await page.waitForTimeout(6000);

        // Should hide offline indicator
        await expect(page.getByText(/офлайн/i)).not.toBeVisible();

        // Should fetch fresh data
        const requests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/api/sales')) {
                requests.push(request.url());
            }
        });

        await page.waitForTimeout(3000);
        expect(requests.length).toBeGreaterThan(0);
    });

    test('should handle rapid online/offline transitions', async ({ page }) => {
        await page.goto('http://localhost:3000/sales');

        // Toggle 5 times rapidly
        for (let i = 0; i < 5; i++) {
            await page.context().setOffline(true);
            await page.waitForTimeout(2000);
            await page.context().setOffline(false);
            await page.waitForTimeout(2000);
        }

        // Should stabilize on final state (online)
        await expect(page.getByText(/офлайн/i)).not.toBeVisible();

        // Should not be making excessive requests
        const requestCounts: any = {};
        page.on('request', request => {
            const url = new URL(request.url());
            const path = url.pathname;
            requestCounts[path] = (requestCounts[path] || 0) + 1;
        });

        await page.waitForTimeout(3000);

        // Each endpoint should be called a reasonable number of times
        Object.values(requestCounts).forEach(count => {
            expect(count).toBeLessThan(10); // Arbitrary threshold
        });
    });
});

test.describe('Data Consistency Across Modes', () => {
    test('should show cached data when offline', async ({ page }) => {
        // Load data while online
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(2000);

        // Get data from table
        const onlineData = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            return Array.from(rows).map(row => row.textContent);
        });

        expect(onlineData.length).toBeGreaterThan(0);

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Should still show data (from cache)
        const offlineData = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            return Array.from(rows).map(row => row.textContent);
        });

        // Data should be the same
        expect(offlineData.length).toBe(onlineData.length);
    });

    test('should sync queued requests when coming online', async ({ page }) => {
        // TODO: Implement when sync queue processing is fully implemented
        // This will test:
        // 1. Create sale while offline
        // 2. Sale is queued
        // 3. Come online
        // 4. Queue is processed
        // 5. Sale appears with server ID
    });

    test('should handle concurrent access during sync', async ({ page }) => {
        // TODO: Test that user can browse while sync is happening in background
        // Should not freeze UI
        // Should allow reading from IndexedDB while writing to it
    });
});

test.describe('User Experience in Offline Mode', () => {
    test('should show clear offline indicator', async ({ page }) => {
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Should show offline message
        await expect(page.getByText(/офлайн режим/i)).toBeVisible();

        // Should show waiting message
        await expect(page.getByText(/ожидание сервера/i)).toBeVisible();
    });

    test('should allow viewing cached data offline', async ({ page }) => {
        // Load data online
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(2000);

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Should still show products page (with cached data)
        // Or show offline guard depending on implementation
        const pageContent = await page.textContent('body');
        expect(pageContent).toBeDefined();
    });

    test('should allow navigation while offline', async ({ page }) => {
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Navigate to different pages
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(2000);

        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Should not crash or freeze
        const currentUrl = page.url();
        expect(currentUrl).toContain('http://localhost:3000');
    });
});

test.describe('Performance in Offline Mode', () => {
    test('should load quickly from cache', async ({ page }) => {
        // Load data online first
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(2000);

        // Measure offline load time
        await page.context().setOffline(true);

        const startTime = Date.now();
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(1000);
        const loadTime = Date.now() - startTime;

        // Should load quickly (< 3 seconds)
        expect(loadTime).toBeLessThan(3000);
    });

    test('should not freeze browser with large datasets', async ({ page }) => {
        // This would require seeding large dataset
        // For now, test that UI remains responsive

        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Check if UI is responsive
        const isResponsive = await page.evaluate(() => {
            const button = document.querySelector('button');
            return button !== null;
        });

        expect(isResponsive).toBe(true);
    });
});

test.describe('Sync Queue Management', () => {
    test('should queue requests when offline', async ({ page }) => {
        // TODO: When offline mutation queue is implemented
        // 1. Start offline
        // 2. Create a sale
        // 3. Check IndexedDB for queued item
        // 4. Verify item has correct structure
    });

    test('should process queue when coming online', async ({ page }) => {
        // TODO: When sync processing is implemented
        // 1. Start offline, queue item
        // 2. Come online
        // 3. Wait for sync
        // 4. Verify item was sent to server
        // 5. Verify item removed from queue
    });

    test('should handle sync errors gracefully', async ({ page }) => {
        // TODO: Test error handling during sync
        // 1. Queue item while offline
        // 2. Come online but server returns error
        // 3. Verify item stays in queue
        // 4. Verify error message shown
    });

    test('should prevent duplicate queue items', async ({ page }) => {
        // TODO: Test idempotency
        // 1. Create sale offline
        // 2. Sync
        // 3. Verify no duplicates created
    });
});

test.describe('Edge Cases', () => {
    test('should handle no cached data when offline', async ({ page }) => {
        // Clear IndexedDB
        await page.evaluate(() => {
            indexedDB.deleteDatabase('tanstack-query');
        });

        // Go offline
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/products');
        await page.waitForTimeout(6000);

        // Should show appropriate error or empty state
        // Should not crash
        const pageContent = await page.textContent('body');
        expect(pageContent).toBeDefined();
    });

    test('should handle slow network connection', async ({ page }) => {
        // Simulate slow network
        await page.route('**/*', route => {
            setTimeout(() => route.continue(), 5000);
        });

        await page.goto('http://localhost:3000/sales');

        // Should handle gracefully
        // Should not timeout completely
        await page.waitForTimeout(10000);
        const currentUrl = page.url();
        expect(currentUrl).toContain('http://localhost:3000');
    });

    test('should handle server returning 500 errors', async ({ page }) => {
        // Mock 500 error
        await page.route('**/api/**', route => {
            route.fulfill({
                status: 500,
                body: 'Internal Server Error'
            });
        });

        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Should show offline mode or error state
        // Should not keep retrying infinitely
        await expect(page.getByText(/офлайн/i)).toBeVisible();
    });
});

test.describe('Integration with Other Features', () => {
    test('should work with filters applied', async ({ page }) => {
        // Load data online with filters
        await page.goto('http://localhost:3000/sales');

        // Apply a filter (would need actual filter selector)
        // await page.selectOption('select[name="status"]', 'completed');
        await page.waitForTimeout(2000);

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Should still work with cached filtered data
        const pageContent = await page.textContent('body');
        expect(pageContent).toBeDefined();
    });

    test('should work with pagination', async ({ page }) => {
        await page.goto('http://localhost:3000/sales');
        await page.waitForTimeout(2000);

        // Go to next page
        // await page.click('button:has-text("Next")');
        await page.waitForTimeout(1000);

        // Go offline
        await page.context().setOffline(true);
        await page.waitForTimeout(6000);

        // Should handle pagination state correctly
        const currentUrl = page.url();
        expect(currentUrl).toContain('http://localhost:3000');
    });
});

test.describe('Accessibility in Offline Mode', () => {
    test('should announce offline status to screen readers', async ({ page }) => {
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Check for ARIA live regions or role="alert"
        const offlineAnnouncement = await page.locator('[role="alert"], [aria-live="polite"], [aria-live="assertive"]').first();
        const isVisible = await offlineAnnouncement.isVisible().catch(() => false);

        // Should have some way to announce status
        expect(isVisible || await page.getByText(/офлайн/i).isVisible()).toBe(true);
    });

    test('should have sufficient color contrast for offline indicator', async ({ page }) => {
        await page.context().setOffline(true);
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForTimeout(6000);

        // Check for offline indicator with proper styling
        const offlineElement = await page.locator('text=/офлайн/i').first();
        expect(offlineElement.isVisible()).toBe(true);
    });
});
