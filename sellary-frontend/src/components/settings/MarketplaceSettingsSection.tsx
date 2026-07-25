'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { companyApi } from '@/lib/api';
import { queryKeys, useMarketplaceSettings } from '@/hooks/useQueries';
import { useAuthStore } from '@/lib/store';
import type { MarketplaceSettings, MarketplaceSettingsUpdate } from '@/lib/types';

import {
  FormField,
  SettingsCard,
  SettingsToggle,
  StatusBadge,
  inputClass,
  primaryButtonClass,
  textareaClass,
} from './SettingsUI';

type FormState = {
  is_marketplace_enabled: boolean;
  logo_url: string;
  marketplace_description: string;
  supports_delivery: boolean;
  supports_pickup: boolean;
};

const DESCRIPTION_LIMIT = 500;

const toForm = (s: MarketplaceSettings): FormState => ({
  is_marketplace_enabled: s.is_marketplace_enabled,
  logo_url: s.logo_url ?? '',
  marketplace_description: s.marketplace_description ?? '',
  supports_delivery: s.supports_delivery,
  supports_pickup: s.supports_pickup,
});

// Only send fields that actually changed (PATCH semantics). Empty strings map
// back to null so clearing a field is expressible.
const buildPatch = (
  initial: MarketplaceSettings,
  form: FormState,
): MarketplaceSettingsUpdate => {
  const patch: MarketplaceSettingsUpdate = {};
  if (form.is_marketplace_enabled !== initial.is_marketplace_enabled)
    patch.is_marketplace_enabled = form.is_marketplace_enabled;
  if (form.logo_url !== (initial.logo_url ?? ''))
    patch.logo_url = form.logo_url.trim() || null;
  if (form.marketplace_description !== (initial.marketplace_description ?? ''))
    patch.marketplace_description = form.marketplace_description.trim() || null;
  if (form.supports_delivery !== initial.supports_delivery)
    patch.supports_delivery = form.supports_delivery;
  if (form.supports_pickup !== initial.supports_pickup)
    patch.supports_pickup = form.supports_pickup;
  return patch;
};

export default function MarketplaceSettingsSection() {
  const { data: settings, isFetching, isError, refetch } = useMarketplaceSettings();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  const [form, setForm] = useState<FormState | null>(null);

  // Hydrate the editable form once settings load, and re-sync if they change.
  useEffect(() => {
    if (settings) setForm(toForm(settings));
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (patch: MarketplaceSettingsUpdate) =>
      companyApi.updateMarketplace(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.marketplaceSettings(companyId),
      });
      toast.success('Настройки магазина сохранены');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось сохранить настройки');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || !form) return;
    const patch = buildPatch(settings, form);
    if (Object.keys(patch).length === 0) {
      toast.success('Изменений нет');
      return;
    }
    saveMutation.mutate(patch);
  };

  // The query is gated on server health, and a disabled or failed query
  // reports isLoading === false. Keying the placeholder on `!form` alone left
  // this tab showing "Загрузка настроек…" forever, with no error and no way
  // back to the storefront settings.
  if (isError && !form) {
    return (
      <SettingsCard title="Витрина" description="Как магазин выглядит в Telegram-маркетплейсе.">
        <p role="alert" className="text-sm text-[var(--erp-text)]">
          Не удалось загрузить настройки магазина. Проверьте связь с сервером.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          Повторить
        </button>
      </SettingsCard>
    );
  }

  if (!form) {
    return (
      <SettingsCard title="Витрина" description="Как магазин выглядит в Telegram-маркетплейсе.">
        <p role="status" className="text-sm text-[var(--erp-muted)]">
          {isFetching ? 'Загрузка настроек…' : 'Настройки магазина недоступны — нет связи с сервером.'}
        </p>
      </SettingsCard>
    );
  }

  const noPickupOption = !form.supports_delivery && !form.supports_pickup;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <SettingsCard
        title="Витрина"
        description="Как магазин выглядит в Telegram-маркетплейсе."
        actions={
          form.is_marketplace_enabled ? (
            <StatusBadge tone="ok">Магазин открыт</StatusBadge>
          ) : (
            <StatusBadge tone="idle">Магазин закрыт</StatusBadge>
          )
        }
      >
        <div className="max-w-[46rem] space-y-4">
          <SettingsToggle
            label="Включить маркетплейс"
            description="Пока выключено, покупатели не видят ваш магазин."
            checked={form.is_marketplace_enabled}
            onChange={(next) =>
              setForm((f) => (f ? { ...f, is_marketplace_enabled: next } : f))
            }
          />

          <FormField
            id="mp-logo"
            label="Ссылка на логотип"
            hint="Прямая ссылка на изображение — оно показывается в шапке магазина."
          >
            <input
              id="mp-logo"
              type="url"
              value={form.logo_url}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, logo_url: e.target.value } : f))
              }
              placeholder="https://…"
              aria-describedby="mp-logo-hint"
              className={inputClass}
            />
          </FormField>

          <FormField
            id="mp-description"
            label="Описание магазина"
            hint={`${form.marketplace_description.length} из ${DESCRIPTION_LIMIT} символов`}
          >
            <textarea
              id="mp-description"
              rows={3}
              maxLength={DESCRIPTION_LIMIT}
              value={form.marketplace_description}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, marketplace_description: e.target.value } : f,
                )
              }
              placeholder="Коротко о вашем магазине"
              aria-describedby="mp-description-hint"
              className={textareaClass}
            />
          </FormField>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Способы получения"
        description="Хотя бы один способ нужен, чтобы покупатель мог оформить заказ."
      >
        <div className="max-w-[46rem] space-y-3">
          <SettingsToggle
            label="Доставка"
            description="Курьер везёт заказ по адресу покупателя."
            checked={form.supports_delivery}
            onChange={(next) =>
              setForm((f) => (f ? { ...f, supports_delivery: next } : f))
            }
          />
          <SettingsToggle
            label="Самовывоз"
            description="Покупатель забирает заказ в магазине."
            checked={form.supports_pickup}
            onChange={(next) =>
              setForm((f) => (f ? { ...f, supports_pickup: next } : f))
            }
          />
          {noPickupOption ? (
            <p role="alert" className="text-[12px] font-semibold text-[var(--erp-warn)]">
              Оба способа выключены — покупатели не смогут оформить заказ.
            </p>
          ) : null}
        </div>
      </SettingsCard>

      <div className="flex justify-end">
        <button type="submit" disabled={saveMutation.isPending} className={primaryButtonClass}>
          {saveMutation.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
