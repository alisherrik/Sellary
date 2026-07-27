'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';

import api from '@/lib/api';
import {
  SettingsCard,
  dangerButtonClass,
  secondaryButtonClass,
} from '@/components/settings/SettingsUI';

type Connection = {
  url: string;
  enabled: boolean;
  company_name: string;
};

type Agent = {
  client_id: string;
  client_name: string | null;
  user_id: number;
  user_name: string;
  connected_at: string;
  expires_at: string;
  scopes: string[];
};

const SCOPE_LABELS: Record<string, string> = {
  'sellary:reports': 'Отчёты',
  'sellary:purchasing': 'Закупки',
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

function ConnectionUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Long enough to read, short enough that the button is ready again by
      // the time anyone comes back to it.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать. Выделите адрес вручную.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap border border-[var(--erp-divider)] bg-[var(--erp-surface)] px-3 py-2 text-sm text-[var(--erp-text)]">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className={`${secondaryButtonClass} shrink-0 gap-1.5`}
        aria-label="Скопировать адрес подключения"
      >
        {copied ? (
          <>
            <CheckIcon className="h-4 w-4" aria-hidden="true" />
            Скопировано
          </>
        ) : (
          <>
            <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
            Копировать
          </>
        )}
      </button>
    </div>
  );
}

export default function AiConnectorSection() {
  const queryClient = useQueryClient();

  const connection = useQuery<Connection>({
    queryKey: ['mcp-connection'],
    queryFn: async () => (await api.get('/mcp-connector/connection')).data,
  });

  const agents = useQuery<{ agents: Agent[] }>({
    queryKey: ['mcp-agents'],
    queryFn: async () => (await api.get('/mcp-connector/agents')).data,
  });

  const revoke = useMutation({
    mutationFn: async (agent: Agent) =>
      api.delete(`/mcp-connector/agents/${agent.client_id}/${agent.user_id}`),
    onSuccess: () => {
      toast.success('Подключение отозвано');
      queryClient.invalidateQueries({ queryKey: ['mcp-agents'] });
    },
    onError: () => toast.error('Не удалось отозвать подключение'),
  });

  const rows = agents.data?.agents ?? [];

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Адрес подключения"
        description="Вставьте этот адрес в Claude: Settings → Connectors → Add custom connector. Дальше он сам попросит войти и выбрать компанию."
      >
        {connection.isLoading ? (
          <p className="text-sm text-[var(--erp-muted)]">Загрузка…</p>
        ) : connection.data ? (
          <ConnectionUrl url={connection.data.url} />
        ) : (
          <p className="text-sm text-[var(--erp-muted)]">
            Не удалось получить адрес подключения.
          </p>
        )}
        <p className="mt-3 text-sm leading-snug text-[var(--erp-muted)]">
          Агент работает от имени того, кто его подключил, и с его правами. Отчёты он
          только читает; единственное, что он записывает, — приход товара, и только
          после вашего подтверждения.
        </p>
      </SettingsCard>

      <SettingsCard
        title="Подключённые агенты"
        description="Кто сейчас может обращаться к данным этой компании. Отзыв закрывает доступ на обновление; чтобы закрыть его немедленно, отключите модуль «ИИ-коннектор»."
      >
        {agents.isLoading ? (
          <p className="text-sm text-[var(--erp-muted)]">Загрузка…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--erp-muted)]">
            Пока никто не подключён.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--erp-divider)] text-left text-[var(--erp-muted)]">
                  <th className="py-2 pr-3 font-semibold">Приложение</th>
                  <th className="py-2 pr-3 font-semibold">Подключил</th>
                  <th className="py-2 pr-3 font-semibold">Когда</th>
                  <th className="py-2 pr-3 font-semibold">Доступ</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {rows.map((agent) => (
                  <tr
                    key={`${agent.client_id}-${agent.user_id}`}
                    className="border-b border-[var(--erp-divider)] last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-semibold text-[var(--erp-text)]">
                      {agent.client_name || agent.client_id}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--erp-text)]">
                      {agent.user_name}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-[var(--erp-muted)]">
                      {formatDate(agent.connected_at)}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--erp-muted)]">
                      {agent.scopes.length
                        ? agent.scopes
                            .map((scope) => SCOPE_LABELS[scope] ?? scope)
                            .join(', ')
                        : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => revoke.mutate(agent)}
                        disabled={revoke.isPending}
                        className={`${dangerButtonClass} disabled:opacity-50`}
                      >
                        Отозвать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Журнал обращений"
        description="Что именно агент спрашивал и когда."
      >
        <p className="text-sm leading-snug text-[var(--erp-muted)]">
          Появится в следующем обновлении. Пока историю обращений можно посмотреть
          только на стороне самого приложения.
        </p>
      </SettingsCard>
    </div>
  );
}
