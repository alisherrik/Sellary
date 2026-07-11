// Placeholder for Plan "cashier-sync-engine" Task 3 (singleton sync engine).
// sync-store.ts dynamically imports `syncNow`/`refreshCatalog` from this module
// to break the static engine<->store import cycle. This stub exists only so
// Task 1 (sync-store.ts) type-checks and its tests can resolve the module;
// Task 3 replaces this file with the real engine implementation.
export async function syncNow(): Promise<void> {}
export async function refreshCatalog(): Promise<void> {}
