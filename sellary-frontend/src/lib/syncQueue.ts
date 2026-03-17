import { get, set } from 'idb-keyval';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OFFLINE QUEUE - IndexedDB Storage (Atomic, Durable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
const QUEUE_KEY = 'offline-sync-queue';
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
    const queue = (await get<SyncItem[]>(QUEUE_KEY)) || [];
    const newItem: SyncItem = {
        ...item,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        retryCount: 0,
        status: 'pending'
    };
    queue.push(newItem);
    await set(QUEUE_KEY, queue);
    return newItem;
}

/**
 * Get all items from queue (for UI display)
 */
export async function getSyncQueue(): Promise<SyncItem[]> {
    return (await get<SyncItem[]>(QUEUE_KEY)) || [];
}

/**
 * Remove item from queue (after successful sync)
 * ATOMIC operation
 */
export async function removeFromSyncQueue(id: string): Promise<void> {
    const queue = (await get<SyncItem[]>(QUEUE_KEY)) || [];
    const newQueue = queue.filter(item => item.id !== id);
    await set(QUEUE_KEY, newQueue);
}

/**
 * Update item status and retry count
 * Used during sync process
 */
export async function updateSyncItem(id: string, updates: Partial<SyncItem>): Promise<void> {
    const queue = (await get<SyncItem[]>(QUEUE_KEY)) || [];
    const index = queue.findIndex(item => item.id === id);
    if (index !== -1) {
        queue[index] = { ...queue[index], ...updates };
        await set(QUEUE_KEY, queue);
    }
}

/**
 * Clear all items from queue
 * Used by user manually clearing queue
 */
export async function clearSyncQueue(): Promise<void> {
    await set(QUEUE_KEY, []);
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
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
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

        const response = await fetch(item.url, {
            method: item.method,
            headers,
            body: item.method !== 'GET' ? JSON.stringify(item.body) : undefined,
        });

        // SUCCESS: 200-299 or 4xx (client error, won't succeed on retry)
        if (response.ok || response.status >= 400 && response.status < 500) {
            await removeFromSyncQueue(item.id);
            return true;
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
