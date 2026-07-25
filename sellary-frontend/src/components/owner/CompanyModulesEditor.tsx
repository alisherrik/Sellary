'use client';

import { useState } from 'react';
import type { ModuleKey } from '@/lib/modules';

export type BusinessType = 'retail' | 'online' | 'warehouse' | 'kitchen' | 'production';

// Mirrors core/modules.py BUSINESS_TYPE_PRESETS. scripts/check_module_parity.py
// fails CI if the module list drifts; the presets are checked by eye.
const PRESETS: Record<BusinessType, ModuleKey[]> = {
  retail: ['register', 'sales', 'customers', 'inventory', 'purchasing', 'reports'],
  online: ['sales', 'customers', 'inventory', 'shop', 'reports'],
  warehouse: ['inventory', 'purchasing', 'reports'],
  kitchen: ['register', 'sales', 'inventory', 'purchasing', 'reports'],
  production: ['sales', 'customers', 'inventory', 'purchasing', 'reports'],
};

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  retail: 'Магазин',
  online: 'Онлайн-магазин',
  warehouse: 'Склад',
  kitchen: 'Кухня',
  production: 'Производство',
};

const MODULE_LABELS: { key: ModuleKey; label: string }[] = [
  { key: 'register', label: 'Касса' },
  { key: 'sales', label: 'Продажи' },
  { key: 'customers', label: 'Клиенты' },
  { key: 'inventory', label: 'Склад' },
  { key: 'purchasing', label: 'Закупки' },
  { key: 'shop', label: 'Магазин' },
  { key: 'reports', label: 'Отчеты' },
];

interface CompanyModulesEditorProps {
  companyId: number;
  initialBusinessType: BusinessType | null;
  initialModules: ModuleKey[];
  onSave: (payload: {
    business_type: BusinessType | null;
    modules: ModuleKey[];
  }) => Promise<void>;
}

export default function CompanyModulesEditor({
  companyId,
  initialBusinessType,
  initialModules,
  onSave,
}: CompanyModulesEditorProps) {
  const [businessType, setBusinessType] = useState<BusinessType | null>(initialBusinessType);
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set(initialModules));
  const [saving, setSaving] = useState(false);

  // A type seeds the set; it never locks it.
  const applyPreset = (type: BusinessType | null) => {
    setBusinessType(type);
    if (type) setSelected(new Set(PRESETS[type]));
  };

  const toggle = (module: ModuleKey) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        business_type: businessType,
        modules: MODULE_LABELS.map((entry) => entry.key).filter((key) => selected.has(key)),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border border-[var(--erp-divider)] p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[var(--erp-muted)]">
          Тип бизнеса
        </span>
        <select
          value={businessType ?? ''}
          onChange={(event) => applyPreset((event.target.value || null) as BusinessType | null)}
          className="h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
        >
          <option value="">Не указан</option>
          {(Object.keys(PRESETS) as BusinessType[]).map((type) => (
            <option key={type} value={type}>
              {BUSINESS_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-[var(--erp-muted)]">Модули</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULE_LABELS.map(({ key, label }) => (
            <label key={key} className="flex min-h-[44px] items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => toggle(key)}
                className="h-5 w-5 accent-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
              />
              <span className="text-sm text-[var(--erp-text)]">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        data-company-id={companyId}
        className="inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:opacity-50"
      >
        {saving ? 'Сохранение...' : 'Сохранить модули'}
      </button>
    </div>
  );
}
