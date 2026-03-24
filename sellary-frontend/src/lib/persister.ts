import { get, set, del } from 'idb-keyval';
import { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { QUERY_STORAGE_KEY, getTenantStorageKey, getCurrentCompanyId } from './session';

/**
 * Creates an IndexedDB persister for React Query
 */
export function createIDBPersister(idbValidKey: IDBValidKey = QUERY_STORAGE_KEY): Persister {
    const resolveKey = () => getTenantStorageKey(String(idbValidKey), getCurrentCompanyId());

    return {
        persistClient: async (client: PersistedClient) => {
            await set(resolveKey(), client);
        },
        restoreClient: async () => {
            return await get<PersistedClient>(resolveKey());
        },
        removeClient: async () => {
            await del(resolveKey());
        },
    };
}
