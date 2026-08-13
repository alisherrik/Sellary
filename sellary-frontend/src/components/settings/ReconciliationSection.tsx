'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { reconciliationApi } from '@/lib/api';
import { queryKeys, useReconciliation } from '@/hooks/useQueries';
import { useAuthStore } from '@/lib/store';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { formatDateTime, formatIsoDate } from '@/lib/utils';
import type { ConsistencyFinding, ConsistencyReport } from '@/lib/types';

import {
  FormField,
  SettingsCard,
  StatusBadge,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
} from './SettingsUI';

const NOTE_LIMIT = 500;

// A 409 carries either a plain Russian string (future date, not later than the
// previous one, an open shift) or {message, findings} when the checker found
// drift. Same errorText contract the finance and write-off pages use, widened
// by one case rather than duplicated.
const errorText = (detail: unknown, fallback: string) => {
  if (typeof detail === 'string' && detail) return detail;
  const message = (detail as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
};

const findingsOf = (detail: unknown): ConsistencyFinding[] => {
  const findings = (detail as { findings?: unknown } | null)?.findings;
  return Array.isArray(findings) ? (findings as ConsistencyFinding[]) : [];
};

/** Today on the browser's clock, as the `YYYY-MM-DD` a date input speaks. */
const todayValue = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

function FindingsTable({ findings }: { findings: ConsistencyFinding[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--erp-divider)] text-left text-[var(--erp-muted)]">
            <th className="py-2 pr-3 font-semibold">Проверка</th>
            <th className="py-2 pr-3 font-semibold">Где</th>
            <th className="py-2 pr-3 font-semibold">Должно быть</th>
            <th className="py-2 font-semibold">Фактически</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding, index) => (
            <tr
              key={`${finding.check}-${finding.subject}-${index}`}
              className="border-b border-[var(--erp-divider)] last:border-0"
            >
              <td className="py-2.5 pr-3 font-semibold text-[var(--erp-text)]">
                {finding.check}
              </td>
              <td className="py-2.5 pr-3 text-[var(--erp-text)]">
                {finding.subject}
                {finding.note ? (
                  <span className="block text-[12px] text-[var(--erp-muted)]">
                    {finding.note}
                  </span>
                ) : null}
              </td>
              <td className="py-2.5 pr-3 tabular-nums text-[var(--erp-muted)]">
                {finding.expected}
              </td>
              <td className="py-2.5 tabular-nums text-[var(--erp-text)]">
                {finding.actual}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Сверка — declaring the date the open period starts at.
 *
 * The date is a tenant-wide, legally meaningful fact, so it lives on the server
 * as a document and is read back from it. It is deliberately NOT in
 * CompanyProfileSection, whose editable controls are localStorage preferences.
 */
export default function ReconciliationSection() {
  const { data, isFetching, isError, refetch } = useReconciliation();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  const fetchSession = useAuthStore((state) => state.fetchSession);

  const [effectiveFrom, setEffectiveFrom] = useState(todayValue);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  // The drift the server refused over, kept so the owner sees exactly what has
  // to be repaired — and so the override is a deliberate second press, not a
  // checkbox somebody ticked before there was anything to acknowledge.
  const [blockers, setBlockers] = useState<ConsistencyFinding[]>([]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [report, setReport] = useState<ConsistencyReport | null>(null);

  const confirmRef = useRef<HTMLDivElement>(null);
  useDialogFocus(confirmRef, confirming, () => setConfirming(false));

  const checkMutation = useMutation({
    mutationFn: async () => (await reconciliationApi.check()).data,
    onSuccess: setReport,
    onError: (error: any) =>
      toast.error(
        errorText(error.response?.data?.detail, 'Не удалось выполнить проверку'),
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      reconciliationApi.create({
        effective_from: effectiveFrom,
        note: note.trim() || undefined,
        acknowledge_violations: acknowledge,
      }),
    onSuccess: () => {
      toast.success('Сверка проведена');
      setConfirming(false);
      setNote('');
      setBlockers([]);
      setAcknowledge(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation(companyId) });
      // The cut-off rides the session, so every screen that shows it has to be
      // told — otherwise the notice keeps naming the previous date until a
      // reload.
      void fetchSession();
    },
    onError: (error: any) => {
      const detail = error.response?.data?.detail;
      setConfirming(false);
      setBlockers(findingsOf(detail));
      toast.error(errorText(detail, 'Не удалось провести сверку'));
    },
  });

  const latest = data?.latest ?? null;
  const history = data?.history ?? [];

  if (isError && !data) {
    return (
      <SettingsCard title="Сверка" description="Дата, с которой начинается открытый период.">
        <p role="alert" className="text-sm text-[var(--erp-text)]">
          Не удалось загрузить сверки. Проверьте связь с сервером.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className={`${secondaryButtonClass} mt-3`}
        >
          Повторить
        </button>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Последняя сверка"
        description="Всё, что было раньше этой даты, закрыто: отчёты это показывают, но изменить документ уже нельзя."
        actions={
          latest ? (
            <StatusBadge tone="ok">
              Открытый период с {formatIsoDate(latest.effective_from)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="idle">Сверок не было</StatusBadge>
          )
        }
      >
        {!data && isFetching ? (
          <p role="status" className="text-sm text-[var(--erp-muted)]">
            Загрузка сверок…
          </p>
        ) : history.length === 0 ? (
          <p className="text-sm text-[var(--erp-muted)]">
            Компания ещё ни разу не сверялась — вся история открыта для изменений.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--erp-divider)] text-left text-[var(--erp-muted)]">
                  <th className="py-2 pr-3 font-semibold">Открытый период с</th>
                  <th className="py-2 pr-3 font-semibold">Проведена</th>
                  <th className="py-2 font-semibold">Примечание</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--erp-divider)] last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-semibold tabular-nums text-[var(--erp-text)]">
                      {formatIsoDate(row.effective_from)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-[var(--erp-muted)]">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-2.5 text-[var(--erp-muted)]">{row.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Проверка целостности"
        description="Сравнивает остатки со слоями партий, оплаты с суммой чека, смены и переводы. Ничего не меняет."
      >
        <button
          type="button"
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          className={secondaryButtonClass}
        >
          {checkMutation.isPending ? 'Проверяем…' : 'Проверить целостность'}
        </button>

        {report ? (
          <div className="mt-4">
            <p className="text-sm text-[var(--erp-muted)]">
              Проверено {formatDateTime(report.checked_at)}
            </p>
            {report.clean ? (
              <p className="mt-2 text-sm font-semibold text-[var(--erp-success)]">
                Расхождений не найдено.
              </p>
            ) : (
              <div className="mt-2">
                <p className="text-sm font-semibold text-[var(--erp-warn)]">
                  Найдено расхождений: {report.findings.length}. Сверка их не
                  исправляет — она их зафиксирует.
                </p>
                <div className="mt-2">
                  <FindingsTable findings={report.findings} />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Провести сверку"
        description="Дата — первый день, который остаётся открытым. Всё, что раньше неё, закрывается."
      >
        <div className="max-w-[46rem] space-y-4">
          <FormField
            id="reconciliation-date"
            label="Открытый период начинается с"
            hint="Обычно сегодняшний день — после того, как смена закрыта, а товар и касса пересчитаны."
          >
            <input
              id="reconciliation-date"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              aria-describedby="reconciliation-date-hint"
              className={inputClass}
            />
          </FormField>

          <FormField
            id="reconciliation-note"
            label="Примечание"
            hint={`${note.length} из ${NOTE_LIMIT} символов`}
          >
            <textarea
              id="reconciliation-note"
              rows={2}
              maxLength={NOTE_LIMIT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Например: пересчитали склад и кассу"
              aria-describedby="reconciliation-note-hint"
              className={textareaClass}
            />
          </FormField>

          {blockers.length > 0 ? (
            <div
              role="alert"
              className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-4"
            >
              <p className="text-[13px] font-extrabold text-[var(--erp-text)]">
                Проверка нашла расхождения — сверка не проведена.
              </p>
              <p className="mt-1 text-[13px] leading-snug text-[var(--erp-muted)]">
                Закрыть период поверх известного расхождения можно, но исправить его
                после этого будет уже нечем — сначала разберитесь с этими строками.
              </p>
              <div className="mt-3">
                <FindingsTable findings={blockers} />
              </div>
              <label className="mt-3 flex items-start gap-2 text-[13px] text-[var(--erp-text)]">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(event) => setAcknowledge(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  Провести сверку несмотря на расхождения — они будут записаны
                  вместе с ней.
                </span>
              </label>
            </div>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!effectiveFrom || createMutation.isPending}
              className={primaryButtonClass}
            >
              {createMutation.isPending ? 'Проводим…' : 'Провести сверку'}
            </button>
          </div>
        </div>
      </SettingsCard>

      {confirming ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reconciliation-confirm-title"
            tabIndex={-1}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto border-2 border-[var(--erp-divider)] bg-white p-5 shadow-2xl outline-none"
          >
            <h2
              id="reconciliation-confirm-title"
              className="text-lg font-bold text-[var(--erp-text)]"
            >
              Провести сверку с {formatIsoDate(effectiveFrom)}?
            </h2>
            <p className="mt-2 text-sm leading-snug text-[var(--erp-text)]">
              Все документы до {formatIsoDate(effectiveFrom)} станут неизменяемыми:
              чек из закрытого периода больше нельзя ни аннулировать, ни вернуть, а
              приход — отменить. Смотреть и печатать их можно по-прежнему.
            </p>
            <p className="mt-2 text-sm leading-snug text-[var(--erp-muted)]">
              Остатки, партии, долги покупателей, деньги на счетах и незакрытые
              заказы поставщикам переходят дальше без изменений. Отменить сверку из
              программы нельзя.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={secondaryButtonClass}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className={primaryButtonClass}
              >
                {createMutation.isPending ? 'Проводим…' : 'Провести сверку'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
