import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * Check GitHub Releases for a newer signed version.
 * Returns the pending Update (carrying `.version` / `.currentVersion`) or null.
 * Never throws — returns null when offline, when not running under Tauri
 * (e.g. `npm run dev` in a browser), or when there is simply no update.
 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    return update ?? null;
  } catch (e) {
    console.warn('[updater] check failed (treated as no update):', e);
    return null;
  }
}

/** Download + install the update, then relaunch the app onto the new version. */
export async function applyUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
