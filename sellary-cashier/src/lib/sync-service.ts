import {
  getPendingSales,
  updateOutboxStatus,
  addSyncEvent,
  recoverSyncingOutboxSales,
  markOutboxSalesFailed,
} from './db';
import { pushSales, checkHealth } from './api';
import type { SyncSale } from './api';
import { getErrorMessage } from './error';

let isSyncing = false;

export async function syncPendingSales(): Promise<{ synced: number; failed: number }> {
  if (isSyncing) {
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  let synced = 0;
  let failed = 0;
  let sendableIds: number[] = [];

  try {
    const isOnline = await checkHealth();
    if (!isOnline) {
      await addSyncEvent('sync', 'skipped', 'server unreachable');
      return { synced: 0, failed: 0 };
    }

    await recoverSyncingOutboxSales();

    const pending = await getPendingSales();

    const sendable = pending.filter((s) => s.status === 'pending' || s.status === 'failed');
    if (sendable.length === 0) {
      await addSyncEvent('sync', 'skipped', 'no sendable pending sales');
      return { synced: 0, failed: 0 };
    }

    const salesToSync: SyncSale[] = sendable.map((s) => {
      const payload = JSON.parse(s.request_json);
      return {
        client_sale_id: payload.client_sale_id,
        idempotency_key: payload.idempotency_key,
        created_at_client: payload.created_at_client,
        payment_method: payload.payment_method,
        card_type: payload.card_type || null,
        discount_amount: payload.discount_amount || 0,
        paid_amount: payload.paid_amount || 0,
        change_amount: payload.change_amount || 0,
        notes: payload.notes || null,
        items: payload.items,
      };
    });

    sendableIds = sendable.map((s) => s.id);

    for (const sale of sendable) {
      await updateOutboxStatus(sale.id, 'syncing');
    }

    const result = await pushSales(salesToSync);

    for (const saleResult of result.results) {
      const localSale = sendable.find(
        (s) => s.client_sale_id === saleResult.client_sale_id
      );
      if (!localSale) continue;

      if (saleResult.status === 'synced' || saleResult.status === 'duplicate') {
        await updateOutboxStatus(
          localSale.id,
          'synced',
          JSON.stringify(saleResult)
        );
        synced++;
      } else {
        await updateOutboxStatus(
          localSale.id,
          'failed',
          undefined,
          saleResult.error || 'Unknown error'
        );
        failed++;
      }
    }

    await addSyncEvent('sync', 'completed', `synced=${synced} failed=${failed}`);
  } catch (e: unknown) {
    const msg = getErrorMessage(e, 'Sync error');
    failed = sendableIds.length;
    await markOutboxSalesFailed(sendableIds, msg).catch((error) => {
      console.warn('Failed to mark outbox sales as failed after sync error', error);
    });
    await addSyncEvent('sync', 'error', msg).catch((error) => {
      console.warn('Failed to write sync error event', error);
    });
  } finally {
    isSyncing = false;
  }

  return { synced, failed };
}
