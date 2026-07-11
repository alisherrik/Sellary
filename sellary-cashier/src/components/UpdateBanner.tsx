import { useEffect, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import toast from 'react-hot-toast';
import { checkForUpdate, applyUpdate } from '../lib/updater';

/**
 * Self-checking update prompt. Mounted once (in App). On mount it asks GitHub
 * Releases whether a newer signed version exists; if so it shows a non-blocking
 * banner with «Обновить» / «Позже». Renders nothing when there is no update
 * (offline, up to date, or not running under Tauri).
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((u) => {
      if (!cancelled) setUpdate(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  const onUpdate = async () => {
    setBusy(true);
    try {
      await toast.promise(applyUpdate(update), {
        loading: 'Обновление загружается…',
        success: 'Обновлено — перезапуск…',
        error: 'Не удалось обновить',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-white p-4 shadow-lg dark:border-blue-900 dark:bg-gray-800">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        Доступно обновление {update.version}
      </p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        Текущая версия: {update.currentVersion}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onUpdate}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Обновление…' : 'Обновить'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Позже
        </button>
      </div>
    </div>
  );
}
