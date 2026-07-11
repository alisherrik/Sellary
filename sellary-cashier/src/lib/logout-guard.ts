export type LogoutDecision =
  | { action: 'blocked'; message: string }
  | { action: 'confirm'; message: string }
  | { action: 'proceed' };

/**
 * §10 logout gating.
 *  - any unsynced (pending + syncing + transient-failed) sale → hard block + syncNow.
 *  - only permanent needs-attention rows → confirm, allow proceed.
 *  - otherwise → proceed.
 */
export function evaluateLogout(
  unsyncedCount: number,
  needsAttentionCount: number,
): LogoutDecision {
  if (unsyncedCount > 0) {
    return {
      action: 'blocked',
      message: `Есть ${unsyncedCount} неотправленных продаж. Дождитесь синхронизации.`,
    };
  }
  if (needsAttentionCount > 0) {
    return {
      action: 'confirm',
      message: `${needsAttentionCount} продаж не удалось отправить, они останутся на устройстве. Выйти?`,
    };
  }
  return { action: 'proceed' };
}
