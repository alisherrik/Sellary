'use client';

import { useState } from 'react';

import type {
  PlatformSettingView,
  PlatformSettingsResponse,
  PlatformSettingsUpdatePayload,
} from '@/lib/types';

type FieldKey = keyof PlatformSettingsUpdatePayload;

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'telegram_bot_token', label: 'Токен бота' },
  { key: 'telegram_webhook_secret', label: 'Секрет вебхука' },
  { key: 'cloudinary_url', label: 'Cloudinary URL' },
];

const SOURCE_LABEL: Record<PlatformSettingView['source'], string> = {
  db: 'из базы данных',
  env: 'из переменной окружения',
  unset: 'не задано',
};

function hint(view: PlatformSettingView): string {
  if (!view.is_set) {
    return 'Не задано';
  }
  return `Задано (${view.masked}) — ${SOURCE_LABEL[view.source]}`;
}

export default function PlatformSettingsSection({
  settings,
  onSave,
}: {
  settings: PlatformSettingsResponse;
  onSave: (payload: PlatformSettingsUpdatePayload) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    telegram_bot_token: '',
    telegram_webhook_secret: '',
    cloudinary_url: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Blank-preserves: only non-empty inputs go into the payload.
    const payload: PlatformSettingsUpdatePayload = {};
    for (const { key } of FIELDS) {
      const trimmed = values[key].trim();
      if (trimmed) {
        payload[key] = trimmed;
      }
    }
    setSaving(true);
    try {
      await onSave(payload);
      setValues({
        telegram_bot_token: '',
        telegram_webhook_secret: '',
        cloudinary_url: '',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-slate-950">Настройки платформы</h2>
        <p className="mt-1 text-sm text-slate-500">
          Общие секреты маркетплейса (единый бот и Cloudinary). Оставьте поле
          пустым, чтобы сохранить текущее значение.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        {FIELDS.map(({ key, label }) => {
          const view = settings[key];
          return (
            <div key={key} className="grid gap-1">
              <label htmlFor={`ps-${key}`} className="text-sm font-medium text-slate-700">
                {label}
              </label>
              <input
                id={`ps-${key}`}
                type="password"
                autoComplete="new-password"
                value={values[key]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder={view.is_set ? view.masked || '••••' : 'Не задано'}
                className="h-11 rounded-xl border border-slate-200 px-3 text-sm"
              />
              <span className="text-xs text-slate-500">{hint(view)}</span>
            </div>
          );
        })}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  );
}
