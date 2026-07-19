'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { companyApi } from '@/lib/api';
import { queryKeys, useMarketplaceSettings } from '@/hooks/useQueries';
import { useAuthStore } from '@/lib/store';
import type { MarketplaceSettings, MarketplaceSettingsUpdate } from '@/lib/types';

type FormState = {
  is_marketplace_enabled: boolean;
  logo_url: string;
  marketplace_description: string;
  supports_delivery: boolean;
  supports_pickup: boolean;
};

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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default function MarketplaceSettingsSection() {
  const { data: settings, isLoading } = useMarketplaceSettings();
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

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <BuildingStorefrontIcon className="h-5 w-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Магазин в маркетплейсе</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Настройте витрину: включите магазин, добавьте логотип и описание, выберите
          способы доставки.
        </p>
      </div>

      <div className="p-4 sm:p-6">
        {isLoading || !form ? (
          <p className="text-sm text-gray-500">Загрузка настроек…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <Toggle
              label="Включить маркетплейс"
              checked={form.is_marketplace_enabled}
              onChange={(next) =>
                setForm((f) => (f ? { ...f, is_marketplace_enabled: next } : f))
              }
            />

            <div>
              <label
                htmlFor="mp-logo"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Ссылка на логотип
              </label>
              <input
                id="mp-logo"
                type="url"
                value={form.logo_url}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, logo_url: e.target.value } : f))
                }
                placeholder="https://…"
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="mp-description"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Описание магазина
              </label>
              <textarea
                id="mp-description"
                maxLength={500}
                value={form.marketplace_description}
                onChange={(e) =>
                  setForm((f) =>
                    f ? { ...f, marketplace_description: e.target.value } : f,
                  )
                }
                placeholder="Коротко о вашем магазине"
                className="h-20 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-900">Способы получения</p>
              <Toggle
                label="Доставка"
                checked={form.supports_delivery}
                onChange={(next) =>
                  setForm((f) => (f ? { ...f, supports_delivery: next } : f))
                }
              />
              <Toggle
                label="Самовывоз"
                checked={form.supports_pickup}
                onChange={(next) =>
                  setForm((f) => (f ? { ...f, supports_pickup: next } : f))
                }
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
