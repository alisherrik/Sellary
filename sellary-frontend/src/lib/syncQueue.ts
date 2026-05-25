import { get, set } from 'idb-keyval';
import {
    SYNC_QUEUE_STORAGE_KEY,
    getActiveAccessToken,
    getTenantStorageKey,
    getCurrentCompanyId,
} from './session';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UUID GENERATION (secure-context safe)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        arr[6] = (arr[6] & 0x0f) | 0x40;
        arr[8] = (arr[8] & 0x3f) | 0x80;
        const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0'));
        return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OFFLINE QUEUE - IndexedDB Storage (Atomic, Durable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SyncWarning {
    product_name: string;
    requested: number;
    available: number;
    new_balance: number;
}

export interface SyncItem {
    id: string;                    // UUID
    url: string;                   // '/api/sales'
    method: string;                // 'POST', 'PUT', etc.
    body: any;                     // Request payload
    timestamp: number;             // Date.now()
    type: 'sale' | 'other';        // For categorization
    retryCount: number;            // 0-5 max
    lastError?: string;            // Error message for UI
    status: 'pending' | 'syncing' | 'failed'; // For UI display
    idempotencyKey?: string;       // Stable key for idempotent endpoints
    syncWarnings?: SyncWarning[];  // Warnings from sync response (stock oversell etc.)
}

export interface SyncConfig {
    autoSync: boolean;             // Default: true
    maxRetries: number;            // Default: 5
}

export interface SyncResult {
    processed: number;
    failed: number;
    skipped: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INDEXEDDB CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const QUEUE_KEY = SYNC_QUEUE_STORAGE_KEY;
const CONFIG_KEY = 'offline-sync-config';
const DEFAULT_CONFIG: SyncConfig = {
    autoSync: true,
    maxRetries: 5
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export async function getSyncConfig(): Promise<SyncConfig> {
    const config = await get<SyncConfig>(CONFIG_KEY);
    return config || DEFAULT_CONFIG;
}

export async function setSyncConfig(config: SyncConfig): Promise<void> {
    await set(CONFIG_KEY, config);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUEUE OPERATIONS (Atomic, Durable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Add item to sync queue (ATOMIC operation)
 * Survives: refresh, crash, update
 */
export async function addToSyncQueue(item: Omit<SyncItem, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<SyncItem> {
    const queue = (await get<SyncItem[]>(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()))) || [];

    // NOTE: read-modify-write is not atomic across tabs.
    // Multi-tab usage is unsupported for sync queue operations.

    // Client-side dedup: skip if an item with the same idempotencyKey already exists
    const newIdempotencyKey = item.idempotencyKey ?? (item.type === 'sale' ? generateUUID() : undefined);
    if (newIdempotencyKey) {
        const existing = queue.find(q => q.idempotencyKey === newIdempotencyKey);
        if (existing) {
            return existing;
        }
    }

    // Max items cap
    if (queue.length >= 400) {
        window.dispatchEvent(new CustomEvent('sync-queue-warning', {
            detail: { message: 'Очередь синхронизации переполнена (макс. 500 чеков).' }
        }));
    }
    if (queue.length >= 500) {
        throw new Error('Очередь синхронизации переполнена (макс. 500 чеков).');
    }

    const newItem: SyncItem = {
        ...item,
        id: generateUUID(),
        timestamp: Date.now(),
        retryCount: 0,
        status: 'pending',
        idempotencyKey: newIdempotencyKey,
    };
    queue.push(newItem);
    await set(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()), queue);
    return newItem;
}

/**
 * Get all items from queue (for UI display)
 */
export async function getSyncQueue(): Promise<SyncItem[]> {
    return (await get<SyncItem[]>(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()))) || [];
}

/**
 * Remove item from queue (after successful sync)
 * ATOMIC operation
 */
export async function removeFromSyncQueue(id: string): Promise<void> {
    const queue = (await get<SyncItem[]>(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()))) || [];
    const newQueue = queue.filter(item => item.id !== id);
    await set(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()), newQueue);
}

/**
 * Update item status and retry count
 * Used during sync process
 */
export async function updateSyncItem(id: string, updates: Partial<SyncItem>): Promise<void> {
    const queue = (await get<SyncItem[]>(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()))) || [];
    const index = queue.findIndex(item => item.id === id);
    if (index !== -1) {
        queue[index] = { ...queue[index], ...updates };
        await set(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()), queue);
    }
}

/**
 * Clear all items from queue
 * Used by user manually clearing queue
 */
export async function clearSyncQueue(): Promise<void> {
    await set(getTenantStorageKey(QUEUE_KEY, getCurrentCompanyId()), []);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SYNC PROCESSING (with retry logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Calculate exponential backoff delay
 * Pattern: 1s, 2s, 4s, 8s, 60s (max)
 */
function getBackoffDelay(retryCount: number): number {
    const delays = [1000, 2000, 4000, 8000, 60000]; // ms
    return delays[Math.min(retryCount, delays.length - 1)];
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
    return getActiveAccessToken();
}

/**
 * Process a single sync item with retry logic
 */
async function processSyncItem(item: SyncItem, config: SyncConfig): Promise<boolean> {
    const maxRetries = config.maxRetries;

    // Check if already exceeded max retries
    if (item.retryCount >= maxRetries) {
        console.warn(`Item ${item.id} exceeded max retries (${maxRetries})`);
        await updateSyncItem(item.id, {
            status: 'failed',
            lastError: `Exceeded max retries (${maxRetries})`
        });
        return false;
    }

    // Update status to syncing
    await updateSyncItem(item.id, { status: 'syncing' });

    try {
        const token = getAuthToken();
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        if (item.idempotencyKey) {
            headers['Idempotency-Key'] = item.idempotencyKey;
        }

        if (item.url === '/api/sales' && item.method === 'POST') {
            headers['X-Offline-Sync'] = 'true';
        }

        const response = await fetch(item.url, {
            method: item.method,
            headers,
            body: item.method !== 'GET' ? JSON.stringify(item.body) : undefined,
        });

        if (response.ok || response.status === 409) {
            let responseData: any = null;
            try {
                responseData = await response.json();
            } catch {
                // Response may not be JSON (e.g. 204 No Content)
            }

            // 409 Conflict means idempotency key already consumed — server accepted a prior request.
            // Treat as success and remove from queue.
            if (response.status === 409) {
                console.log(`Sync item ${item.id}: idempotency key already consumed (409), removing from queue`);
                await removeFromSyncQueue(item.id);
                return true;
            }

            // Post-sync verification: best-effort confirm sale exists on the server.
            // A transient GET failure does NOT invalidate a successful POST.
            if (item.url === '/api/sales' && item.method === 'POST' && responseData?.id) {
                try {
                    const verifyResponse = await fetch(`/api/sales/${responseData.id}`, {
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    });
                    if (!verifyResponse.ok) {
                        console.warn(`Post-sync verification warning: sale ${responseData.id} returned ${verifyResponse.status}`);
                    }
                } catch (verifyError) {
                    console.warn(`Post-sync verification warning: could not reach /api/sales/${responseData.id}`, verifyError);
                }
            }

            // Store sync_warnings on the item for UI display
            if (responseData?.sync_warnings && Array.isArray(responseData.sync_warnings)) {
                await updateSyncItem(item.id, {
                    syncWarnings: responseData.sync_warnings,
                });
            }

            await removeFromSyncQueue(item.id);
            return true;
        }

        if (response.status >= 400 && response.status < 500) {
            const errorMsg = `Client error: ${response.status} ${response.statusText}`;
            console.warn(`Sync failed for ${item.id}: ${errorMsg}`);
            await updateSyncItem(item.id, {
                status: 'failed',
                retryCount: item.retryCount + 1,
                lastError: errorMsg,
            });
            return false;
        }

        // SERVER ERROR: 5xx - will retry
        const errorMsg = `Server error: ${response.status} ${response.statusText}`;
        console.warn(`Sync failed for ${item.id}: ${errorMsg}`);

        const newRetryCount = item.retryCount + 1;
        if (newRetryCount >= maxRetries) {
            await updateSyncItem(item.id, {
                status: 'failed',
                retryCount: newRetryCount,
                lastError: errorMsg
            });
            return false;
        }

        // Retry with backoff
        const delay = getBackoffDelay(newRetryCount);
        console.log(`Retrying ${item.id} in ${delay}ms (attempt ${newRetryCount}/${maxRetries})`);
        await sleep(delay);

        // Recursive retry
        return await processSyncItem({ ...item, retryCount: newRetryCount }, config);

    } catch (error) {
        // NETWORK ERROR - will retry
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Network error syncing ${item.id}:`, errorMsg);

        const newRetryCount = item.retryCount + 1;
        if (newRetryCount >= maxRetries) {
            await updateSyncItem(item.id, {
                status: 'failed',
                retryCount: newRetryCount,
                lastError: errorMsg
            });
            return false;
        }

        // Retry with backoff
        const delay = getBackoffDelay(newRetryCount);
        await sleep(delay);

        // Recursive retry
        return await processSyncItem({ ...item, retryCount: newRetryCount }, config);
    }
}

/**
 * Process all queued items when server comes back online
 * Makes HTTP requests for each item and removes successful ones
 *
 * @param force If true, ignores the autoSync setting and forces processing
 * @returns SyncResult with counts and skip status
 */
export async function processQueue(force: boolean = false): Promise<SyncResult> {
    const config = await getSyncConfig();

    // If not forced and autoSync is disabled, skip processing
    if (!force && !config.autoSync) {
        return { processed: 0, failed: 0, skipped: true };
    }

    const queue = await getSyncQueue();

    if (queue.length === 0) {
        return { processed: 0, failed: 0, skipped: false };
    }

    let processed = 0;
    let failed = 0;

    // Process each item independently (partial success allowed)
    for (const item of queue) {
        // Skip items that are already being synced or permanently failed
        if (item.status === 'syncing') {
            continue;
        }

        const success = await processSyncItem(item, config);
        if (success) {
            processed++;
        } else {
            failed++;
        }
    }

    return { processed, failed, skipped: false };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUEUE STATUS (for UI display)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface QueueStatus {
    total: number;
    pending: number;
    syncing: number;
    failed: number;
}

/**
 * Get queue status for UI display
 */
export async function getQueueStatus(): Promise<QueueStatus> {
    const queue = await getSyncQueue();
    return {
        total: queue.length,
        pending: queue.filter(i => i.status === 'pending').length,
        syncing: queue.filter(i => i.status === 'syncing').length,
        failed: queue.filter(i => i.status === 'failed').length,
    };
}
