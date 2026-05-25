'use client';

interface StorageEstimate {
  usage: number;
  quota: number;
  percentUsed: number;
}

let warningShown = false;
const WARN_THRESHOLD_MB = 40;
const BLOCK_THRESHOLD_MB = 50;

export async function getStorageEstimate(): Promise<StorageEstimate> {
  const estimate = await navigator.storage.estimate();
  const usage = (estimate.usage || 0) / (1024 * 1024);
  const quota = (estimate.quota || 0) / (1024 * 1024);
  return { usage, quota, percentUsed: (usage / quota) * 100 };
}

export async function isStorageAvailable(): Promise<boolean> {
  const { usage } = await getStorageEstimate();
  if (usage >= BLOCK_THRESHOLD_MB) {
    return false;
  }
  if (usage >= WARN_THRESHOLD_MB && !warningShown) {
    warningShown = true;
    console.warn(`Storage usage high: ${usage.toFixed(1)}MB. Clear app data in browser settings.`);
    window.dispatchEvent(new CustomEvent('sync-queue-warning', {
      detail: { message: `Заканчивается место (${usage.toFixed(0)}MB). Очистите данные приложения в настройках браузера.` }
    }));
  }
  if (usage < WARN_THRESHOLD_MB) {
    warningShown = false;
  }
  return true;
}

export function getStorageErrorMessage(): string {
  return 'Недостаточно места. Очистите данные приложения в настройках браузера.';
}
