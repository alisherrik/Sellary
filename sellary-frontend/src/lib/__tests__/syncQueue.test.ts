import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue, processQueue, updateSyncItem, SyncItem } from '../syncQueue';
import { getTenantStorageKey, setCurrentCompanyId, SYNC_QUEUE_STORAGE_KEY } from '../session';

/**
 * UNIT TESTS FOR SYNC QUEUE
 *
 * Tests offline request queue management, including:
 * - Adding items to queue
 * - Retrieving queue
 * - Removing items from queue
 * - Queue persistence in IndexedDB
 */

// Mock idb-keyval
vi.mock('idb-keyval', () => ({
    get: vi.fn(),
    set: vi.fn(),
}));

import { get, set } from 'idb-keyval';

const QUEUE_KEY = getTenantStorageKey(SYNC_QUEUE_STORAGE_KEY, null);

describe('syncQueue - addToSyncQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should add item to empty queue', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale' as const,
        };

        const result = await addToSyncQueue(item);

        // Should have retrieved empty queue
        expect(get).toHaveBeenCalledWith(QUEUE_KEY);

        // Should have saved queue with new item
        expect(set).toHaveBeenCalledWith(
            QUEUE_KEY,
            expect.arrayContaining([
                expect.objectContaining({
                    id: expect.any(String),
                    url: '/api/sales',
                    method: 'POST',
                    body: { total: 100 },
                    type: 'sale',
                    timestamp: expect.any(Number),
                    retryCount: 0,
                    status: 'pending',
                }),
            ])
        );

        // Should return the created item with id and timestamp
        expect(result).toMatchObject({
            id: expect.any(String),
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale',
            timestamp: expect.any(Number),
            retryCount: 0,
            status: 'pending',
        });
    });

    it('should add item to existing queue', async () => {
        const existingQueue: SyncItem[] = [
            {
                id: 'existing-id',
                url: '/api/products',
                method: 'POST',
                body: { name: 'Product' },
                timestamp: Date.now() - 1000,
                type: 'other',
            },
        ];

        vi.mocked(get).mockResolvedValue(existingQueue);
        vi.mocked(set).mockResolvedValue(undefined);

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale' as const,
        };

        await addToSyncQueue(item);

        // Should have saved queue with both items
        expect(set).toHaveBeenCalledWith(
            QUEUE_KEY,
            expect.arrayContaining([
                expect.objectContaining({ id: 'existing-id' }),
                expect.objectContaining({ url: '/api/sales' }),
            ])
        );
    });

    it('should generate unique ID for each item', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale' as const,
        };

        const item1 = await addToSyncQueue(item);
        const item2 = await addToSyncQueue(item);

        expect(item1.id).not.toBe(item2.id);
    });

    it('should add timestamp to item', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const beforeTimestamp = Date.now();

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale' as const,
        };

        const result = await addToSyncQueue(item);

        const afterTimestamp = Date.now();

        expect(result.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(result.timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should handle different request types', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const saleItem = await addToSyncQueue({
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale',
        });

        const otherItem = await addToSyncQueue({
            url: '/api/products',
            method: 'PUT',
            body: { name: 'Product' },
            type: 'other',
        });

        expect(saleItem.type).toBe('sale');
        expect(otherItem.type).toBe('other');
    });
});

describe('syncQueue - getSyncQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should return empty array when no items in queue', async () => {
        vi.mocked(get).mockResolvedValue([]);

        const queue = await getSyncQueue();

        expect(get).toHaveBeenCalledWith(QUEUE_KEY);
        expect(queue).toEqual([]);
    });

    it('should return empty array when queue does not exist', async () => {
        vi.mocked(get).mockResolvedValue(undefined);

        const queue = await getSyncQueue();

        expect(get).toHaveBeenCalledWith(QUEUE_KEY);
        expect(queue).toEqual([]);
    });

    it('should return all items in queue', async () => {
        const mockQueue: SyncItem[] = [
            {
                id: 'id-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now(),
                type: 'sale',
            },
            {
                id: 'id-2',
                url: '/api/products',
                method: 'POST',
                body: { name: 'Product' },
                timestamp: Date.now(),
                type: 'other',
            },
        ];

        vi.mocked(get).mockResolvedValue(mockQueue);

        const queue = await getSyncQueue();

        expect(queue).toEqual(mockQueue);
        expect(queue).toHaveLength(2);
    });

    it('should return items in correct order', async () => {
        const mockQueue: SyncItem[] = [
            {
                id: 'id-1',
                url: '/api/sales/1',
                method: 'POST',
                body: { total: 100 },
                timestamp: 1000,
                type: 'sale',
            },
            {
                id: 'id-2',
                url: '/api/sales/2',
                method: 'POST',
                body: { total: 200 },
                timestamp: 2000,
                type: 'sale',
            },
        ];

        vi.mocked(get).mockResolvedValue(mockQueue);

        const queue = await getSyncQueue();

        expect(queue[0].timestamp).toBeLessThan(queue[1].timestamp);
    });
});

describe('syncQueue - removeFromSyncQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should remove item from queue by ID', async () => {
        const mockQueue: SyncItem[] = [
            {
                id: 'id-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now(),
                type: 'sale',
            },
            {
                id: 'id-2',
                url: '/api/products',
                method: 'POST',
                body: { name: 'Product' },
                timestamp: Date.now(),
                type: 'other',
            },
        ];

        vi.mocked(get).mockResolvedValue(mockQueue);
        vi.mocked(set).mockResolvedValue(undefined);

        await removeFromSyncQueue('id-1');

        // Should save queue without the removed item
        expect(set).toHaveBeenCalledWith(
            QUEUE_KEY,
            expect.arrayContaining([
                expect.objectContaining({ id: 'id-2' }),
            ])
        );

        // Should NOT include the removed item
        const savedQueue = vi.mocked(set).mock.calls[0][1];
        expect(savedQueue).not.toContainEqual(expect.objectContaining({ id: 'id-1' }));
        expect(savedQueue).toHaveLength(1);
    });

    it('should handle removing non-existent ID', async () => {
        const mockQueue: SyncItem[] = [
            {
                id: 'id-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now(),
                type: 'sale',
            },
        ];

        vi.mocked(get).mockResolvedValue(mockQueue);
        vi.mocked(set).mockResolvedValue(undefined);

        await removeFromSyncQueue('non-existent-id');

        // Should save queue unchanged
        expect(set).toHaveBeenCalledWith(QUEUE_KEY, mockQueue);
    });

    it('should handle removing from empty queue', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        await removeFromSyncQueue('id-1');

        // Should save empty queue
        expect(set).toHaveBeenCalledWith(QUEUE_KEY, []);
    });

    it('should handle removing last item in queue', async () => {
        const mockQueue: SyncItem[] = [
            {
                id: 'id-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now(),
                type: 'sale',
            },
        ];

        vi.mocked(get).mockResolvedValue(mockQueue);
        vi.mocked(set).mockResolvedValue(undefined);

        await removeFromSyncQueue('id-1');

        // Should save empty queue
        expect(set).toHaveBeenCalledWith(QUEUE_KEY, []);
    });
});

describe('syncQueue - Integration Scenarios', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should handle complete workflow: add, get, remove', async () => {
        // Start with empty queue
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        // Add item
        const added = await addToSyncQueue({
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            type: 'sale',
        });

        // Get queue
        vi.mocked(get).mockResolvedValue([added]);
        const queue = await getSyncQueue();
        expect(queue).toHaveLength(1);

        // Remove item
        await removeFromSyncQueue(added.id);

        // Verify removal
        vi.mocked(get).mockResolvedValue([]);
        const finalQueue = await getSyncQueue();
        expect(finalQueue).toHaveLength(0);
    });

    it('should maintain queue order across operations', async () => {
        const items: SyncItem[] = [];

        // Add 3 items
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        for (let i = 1; i <= 3; i++) {
            const item = await addToSyncQueue({
                url: `/api/sales/${i}`,
                method: 'POST',
                body: { total: i * 100 },
                type: 'sale',
            });
            items.push(item);

            // Update get mock for next call
            vi.mocked(get).mockResolvedValue([...items]);
        }

        // Get queue
        const queue = await getSyncQueue();
        expect(queue).toHaveLength(3);
        expect(queue[0].url).toBe('/api/sales/1');
        expect(queue[2].url).toBe('/api/sales/3');

        // Remove middle item
        await removeFromSyncQueue(items[1].id);

        // Verify order maintained - check the last set call
        const lastSetCall = vi.mocked(set).mock.calls[vi.mocked(set).mock.calls.length - 1][1] as SyncItem[];
        expect(lastSetCall).toHaveLength(2);
        expect(lastSetCall[0].url).toBe('/api/sales/1');
        expect(lastSetCall[1].url).toBe('/api/sales/3');
    });
});

describe('syncQueue - Deduplication by idempotencyKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should skip adding item with same idempotencyKey', async () => {
        const existingItem: SyncItem = {
            id: 'existing-id',
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            timestamp: Date.now(),
            type: 'sale',
            retryCount: 0,
            status: 'pending',
            idempotencyKey: 'dedup-key-123',
        };

        vi.mocked(get).mockResolvedValue([existingItem]);
        vi.mocked(set).mockResolvedValue(undefined);

        const result = await addToSyncQueue({
            url: '/api/sales',
            method: 'POST',
            body: { total: 200 },
            type: 'sale',
            idempotencyKey: 'dedup-key-123',
        });

        expect(result).toEqual(existingItem);
        expect(set).not.toHaveBeenCalled();
    });

    it('should allow different idempotencyKeys', async () => {
        const existingItem: SyncItem = {
            id: 'existing-id',
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            timestamp: Date.now(),
            type: 'sale',
            retryCount: 0,
            status: 'pending',
            idempotencyKey: 'key-1',
        };

        vi.mocked(get).mockResolvedValue([existingItem]);
        vi.mocked(set).mockResolvedValue(undefined);

        const result = await addToSyncQueue({
            url: '/api/sales',
            method: 'POST',
            body: { total: 200 },
            type: 'sale',
            idempotencyKey: 'key-2',
        });

        expect(result.id).not.toBe(existingItem.id);
        expect(result.idempotencyKey).toBe('key-2');
        expect(set).toHaveBeenCalled();
    });
});

describe('syncQueue - Max Items Limit (500)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should throw when adding 501st item', async () => {
        const fullQueue: SyncItem[] = Array.from({ length: 500 }, (_, i) => ({
            id: `id-${i}`,
            url: `/api/sales/${i}`,
            method: 'POST',
            body: { total: i * 100 },
            timestamp: Date.now() - i,
            type: 'sale' as const,
            retryCount: 0,
            status: 'pending' as const,
            idempotencyKey: `key-${i}`,
        }));

        vi.mocked(get).mockResolvedValue(fullQueue);
        vi.mocked(set).mockResolvedValue(undefined);

        await expect(
            addToSyncQueue({
                url: '/api/sales/501',
                method: 'POST',
                body: { total: 50100 },
                type: 'sale',
            })
        ).rejects.toThrow('Очередь синхронизации переполнена');
    });

    it('should allow 500th item', async () => {
        const queue499: SyncItem[] = Array.from({ length: 499 }, (_, i) => ({
            id: `id-${i}`,
            url: `/api/sales/${i}`,
            method: 'POST',
            body: { total: i * 100 },
            timestamp: Date.now() - i,
            type: 'sale' as const,
            retryCount: 0,
            status: 'pending' as const,
            idempotencyKey: `key-${i}`,
        }));

        vi.mocked(get).mockResolvedValue(queue499);
        vi.mocked(set).mockResolvedValue(undefined);

        const result = await addToSyncQueue({
            url: '/api/sales/500',
            method: 'POST',
            body: { total: 50000 },
            type: 'sale',
        });

        expect(result).toBeDefined();
        expect(set).toHaveBeenCalled();
    });
});

describe('syncQueue - Edge Cases', () => {
    it('should handle concurrent adds to queue', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        // Add multiple items concurrently
        const promises = [
            addToSyncQueue({
                url: '/api/sales/1',
                method: 'POST',
                body: { total: 100 },
                type: 'sale',
            }),
            addToSyncQueue({
                url: '/api/sales/2',
                method: 'POST',
                body: { total: 200 },
                type: 'sale',
            }),
            addToSyncQueue({
                url: '/api/sales/3',
                method: 'POST',
                body: { total: 300 },
                type: 'sale',
            }),
        ];

        const results = await Promise.all(promises);

        // All items should have unique IDs
        const ids = results.map((r) => r.id);
        expect(new Set(ids).size).toBe(3);
    });

    it('should handle special characters in request body', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: {
                customerName: 'О customer name',
                notes: 'Special chars: <>&\'"',
            },
            type: 'sale' as const,
        };

        const result = await addToSyncQueue(item);

        expect(result.body).toEqual(item.body);
    });

    it('should handle large request bodies', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const largeItems = Array.from({ length: 100 }, (_, i) => ({
            id: `product-${i}`,
            name: `Product ${i}`,
            price: i * 10,
        }));

        const item = {
            url: '/api/sales',
            method: 'POST',
            body: { items: largeItems },
            type: 'sale' as const,
        };

        const result = await addToSyncQueue(item);

        expect(result.body.items).toHaveLength(100);
    });

    it('should handle different HTTP methods', async () => {
        vi.mocked(get).mockResolvedValue([]);
        vi.mocked(set).mockResolvedValue(undefined);

        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

        for (const method of methods) {
            const result = await addToSyncQueue({
                url: '/api/test',
                method,
                body: { data: 'test' },
                type: 'other',
            });

            expect(result.method).toBe(method);
        }
    });
});

describe('syncQueue - processQueue replay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentCompanyId(null);
    });

    it('should inject _offline_sync flag into replay requests', async () => {
        const queueItem: SyncItem = {
            id: 'replay-1',
            url: '/api/sales',
            method: 'POST',
            body: { total: 100 },
            timestamp: Date.now(),
            type: 'sale',
            retryCount: 0,
            status: 'pending',
            idempotencyKey: 'ik-replay-1',
        };

        vi.mocked(get).mockImplementation((key: unknown) => {
            if (typeof key === 'string' && key.includes('offline-sync-config')) {
                return Promise.resolve({ autoSync: true, maxRetries: 5 });
            }
            return Promise.resolve([queueItem]);
        });

        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ id: 'sale-1' }),
            } as Response)
        );
        global.fetch = mockFetch;

        const result = await processQueue(true);

        expect(result.processed).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        const postCallArgs = mockFetch.mock.calls[0];
        const requestHeaders = postCallArgs[1].headers;
        expect(requestHeaders['X-Offline-Sync']).toBe('true');
        const requestBody = JSON.parse(postCallArgs[1].body);
        expect(requestBody.total).toBe(100);
    });

    it('should verify sale exists after successful POST replay', async () => {
        const queueItem: SyncItem = {
            id: 'replay-2',
            url: '/api/sales',
            method: 'POST',
            body: { total: 200 },
            timestamp: Date.now(),
            type: 'sale',
            retryCount: 0,
            status: 'pending',
            idempotencyKey: 'ik-replay-2',
        };

        vi.mocked(get).mockImplementation((key: unknown) => {
            if (typeof key === 'string' && key.includes('offline-sync-config')) {
                return Promise.resolve({ autoSync: true, maxRetries: 5 });
            }
            return Promise.resolve([queueItem]);
        });

        let postCalled = false;
        const mockFetch = vi.fn((url: string) => {
            if (url === '/api/sales' && !postCalled) {
                postCalled = true;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: 'sale-2' }),
                } as Response);
            }
            if (url === '/api/sales/sale-2') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: 'sale-2', total: 200 }),
                } as Response);
            }
            return Promise.reject(new Error('Unexpected URL'));
        });
        global.fetch = mockFetch;

        const result = await processQueue(true);

        expect(result.processed).toBe(1);
        expect(mockFetch).toHaveBeenCalledWith('/api/sales/sale-2', expect.anything());
    });

    it('should store sync_warnings on queue item after replay', async () => {
        const queueItem: SyncItem = {
            id: 'replay-3',
            url: '/api/sales',
            method: 'POST',
            body: { total: 300 },
            timestamp: Date.now(),
            type: 'sale',
            retryCount: 0,
            status: 'pending',
            idempotencyKey: 'ik-replay-3',
        };

        const syncWarnings = [
            { product_name: 'Товар А', requested: 5, available: 3, new_balance: -2 },
            { product_name: 'Товар Б', requested: 10, available: 8, new_balance: -2 },
        ];

        vi.mocked(get).mockImplementation((key: unknown) => {
            if (typeof key === 'string' && key.includes('offline-sync-config')) {
                return Promise.resolve({ autoSync: true, maxRetries: 5 });
            }
            return Promise.resolve([queueItem]);
        });

        const updatedItems: SyncItem[] = [];
        vi.mocked(set).mockImplementation((_key: unknown, value: unknown) => {
            if (Array.isArray(value) && value.length > 0) {
                const item = value[0];
                if (item && typeof item === 'object' && 'syncWarnings' in item) {
                    updatedItems.push(item as SyncItem);
                }
            }
            return Promise.resolve(undefined);
        });

        let postCalled = false;
        const mockFetch = vi.fn((url: string) => {
            if (url === '/api/sales' && !postCalled) {
                postCalled = true;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: 'sale-3', sync_warnings: syncWarnings }),
                } as Response);
            }
            if (url === '/api/sales/sale-3') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: 'sale-3' }),
                } as Response);
            }
            return Promise.reject(new Error('Unexpected URL'));
        });
        global.fetch = mockFetch;

        const result = await processQueue(true);

        expect(result.processed).toBe(1);
        expect(updatedItems.length).toBeGreaterThan(0);
        const updatedItem = updatedItems.find(i => i.id === 'replay-3');
        expect(updatedItem).toBeDefined();
        expect(updatedItem!.syncWarnings).toEqual(syncWarnings);
    });
});
