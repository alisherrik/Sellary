import { useState, useCallback } from 'react';
import { getSyncQueue, removeFromSyncQueue } from '@/lib/syncQueue';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { isOfflineModeEnabled } from '@/lib/features';

export function useOfflineSync() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [queueLength, setQueueLength] = useState(0);
    const queryClient = useQueryClient();
    const { isServerReachable } = useServerHealth();

    const checkQueueLength = useCallback(async () => {
        const queue = await getSyncQueue();
        setQueueLength(queue.length);
        return queue.length;
    }, []);

    const processQueue = useCallback(async (manual = false) => {
        if (!isOfflineModeEnabled) {
            if (manual) toast('Офлайн-синхронизация отключена в MVP', { icon: 'i' });
            return;
        }

        // Agar allaqachon jarayon ketayotgan bo'lsa, ikkinchisini boshlamaymiz
        if (isSyncing) return;

        if (!isServerReachable) {
            if (manual) toast.error("Нет соединения с сервером");
            return;
        }

        const queue = await getSyncQueue();
        setQueueLength(queue.length);

        if (queue.length === 0) {
            if (manual) toast.success('Нет данных для синхронизации');
            return;
        }

        setIsSyncing(true);
        // Faqat manual bo'lganda loading ko'rsatamiz, avtomatikda foydalanuvchini chalg'itmaymiz
        const toastId = manual ? toast.loading(`Синхронизация: ${queue.length} шт...`) : undefined;

        let successCount = 0;
        let failCount = 0; // Ketma-ket xatolar soni

        for (const item of queue) {
            // Circuit Breaker: Agar 2 ta ketma-ket jiddiy xato bo'lsa, jarayonni to'xtatamiz
            if (failCount >= 2) {
                console.warn("Too many failures. Stopping sync process temporarily.");
                if (toastId) toast.error("Server bilan aloqa uzildi. Keyinroq urinib ko'ring.", { id: toastId });
                break;
            }

            try {
                const cleanUrl = item.url.startsWith('/api') ? item.url.replace('/api', '') : item.url;
                await api({
                    method: item.method,
                    url: cleanUrl,
                    data: item.body
                });

                await removeFromSyncQueue(item.id);
                successCount++;
                failCount = 0; // Muvaffaqiyatli bo'lsa, xatolar sanog'ini reset qilamiz
                setQueueLength(prev => Math.max(0, prev - 1));

            } catch (error: any) {
                console.error('Sync failed for item', item.id, error);

                // Xato turini aniqlaymiz
                const status = error.response?.status;

                // 1. Agar xato 4xx (Client Error - masalan 400 Bad Request, 422 Validation) bo'lsa
                // Bu ma'lumot baribir qabul qilinmaydi, shuning uchun o'chiramiz.
                if (status && status >= 400 && status < 500) {
                    await removeFromSyncQueue(item.id);
                    setQueueLength(prev => Math.max(0, prev - 1));
                    // Bu "failCount" ni oshirmaydi, chunki bu server muammosi emas, data muammosi
                }

                // 2. Agar xato 5xx (Server Error) yoki Network Error bo'lsa
                else {
                    failCount++; // Jiddiy xato
                }
            }
        }

        setIsSyncing(false);

        if (successCount > 0) {
            const msg = `Синхронизировано: ${successCount}`;
            if (toastId) toast.success(msg, { id: toastId });
            else if (manual) toast.success(msg);

            queryClient.invalidateQueries();
        } else {
            if (toastId) toast.dismiss(toastId);
        }

        // Yakuniy tekshiruv
        checkQueueLength();

    }, [isSyncing, queryClient, checkQueueLength, isServerReachable]);

    return { isSyncing, queueLength, processQueue, checkQueueLength };
}
