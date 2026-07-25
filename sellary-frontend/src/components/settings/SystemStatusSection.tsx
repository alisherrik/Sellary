'use client';

import { useEffect, useState } from 'react';

import { useServerHealth } from '@/providers/ServerHealthProvider';

import { FactRow, SettingsCard, StatusBadge } from './SettingsUI';

/**
 * System status: is the server answering, what is deployed, and which modules
 * this release actually ships. Read-only — nothing here changes state.
 */
export default function SystemStatusSection() {
  const { isServerReachable, isChecking, lastCheckedAt } = useServerHealth();
  const [backendVersion, setBackendVersion] = useState<string | null>(null);

  const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';

  useEffect(() => {
    if (isServerReachable) {
      fetch('/health', { method: 'GET' })
        .then((res) => res.json())
        .then((data) => {
          if (data?.version) {
            setBackendVersion(data.version);
          }
        })
        .catch(() => setBackendVersion(null));
    }
  }, [isServerReachable]);

  const connectionBadge = isChecking ? (
    <StatusBadge tone="warn">Проверка</StatusBadge>
  ) : isServerReachable ? (
    <StatusBadge tone="ok">В сети</StatusBadge>
  ) : (
    <StatusBadge tone="danger">Не в сети</StatusBadge>
  );

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Связь с сервером"
        description="Состояние соединения кассы с сервером Sellary. Проверяется автоматически."
        actions={connectionBadge}
      >
        <p className="text-[13px] text-[var(--erp-muted)]">
          {isServerReachable
            ? 'Продажи уходят на сервер сразу.'
            : 'Сервер не отвечает. Проверьте подключение к сети — продажи не будут сохранены.'}{' '}
          Последняя проверка:{' '}
          <span className="font-semibold tabular-nums text-[var(--erp-text)]">
            {lastCheckedAt ? lastCheckedAt.toLocaleTimeString('ru-RU') : '—'}
          </span>
        </p>
      </SettingsCard>

      <SettingsCard title="Версии" description="Развёрнутые версии сервера и клиента.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-4">
            <div className="text-[13px] font-semibold text-[var(--erp-text)]">Сервер</div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums text-[var(--erp-text)]">
              {isServerReachable && backendVersion ? `v${backendVersion}` : '—'}
            </div>
            <div className="mt-1 text-[12px] text-[var(--erp-muted)]">
              {isChecking ? 'Проверка…' : isServerReachable ? 'Подключён' : 'Недоступен'}
            </div>
          </div>

          <div className="border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-4">
            <div className="text-[13px] font-semibold text-[var(--erp-text)]">Клиент</div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums text-[var(--erp-text)]">
              v{frontendVersion}
            </div>
            <div className="mt-1 text-[12px] text-[var(--erp-muted)]">Это устройство</div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Состав релиза"
        description="Быстрый обзор того, какие модули MVP доступны в данный момент."
      >
        <dl className="max-w-[46rem]">
          <FactRow term="Розничная касса">
            <StatusBadge tone="ok">Активно</StatusBadge>
          </FactRow>
        </dl>
      </SettingsCard>
    </div>
  );
}
