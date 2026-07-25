'use client';

import { useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { categoriesApi } from '@/lib/api';
import type { Category } from '@/lib/types';

interface CategoryPickerProps {
  value: string;
  categories: Category[];
  onChange: (categoryId: string) => void;
  /** Called after a category is created so the caller can refresh its list. */
  onCreated?: (category: Category) => void;
  label?: string;
}

/**
 * Category select that can also create one, in place.
 *
 * The alternative — bouncing to the category manager, or stacking a second
 * modal on top of the product form — costs the user their place in the form
 * they were filling in. Here the field turns into a name input, takes one
 * value, and hands back a selected category.
 */
export default function CategoryPicker({
  value,
  categories,
  onChange,
  onCreated,
  label = 'Категория',
}: CategoryPickerProps) {
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setCreating(false);
    setName('');
    // Focus goes back where it came from, not to the top of the form.
    selectRef.current?.focus();
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setSaving(true);
    try {
      const response = await categoriesApi.create({ name: trimmed });
      const category: Category = response.data;
      onCreated?.(category);
      onChange(String(category.id));
      toast.success(`Категория «${category.name}» создана`);
      setCreating(false);
      setName('');
      selectRef.current?.focus();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Не удалось создать категорию');
    } finally {
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <div>
        <label
          htmlFor={`${id}-new`}
          className="mb-1 block text-xs font-medium text-[var(--erp-muted)]"
        >
          Новая категория
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-new`}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not submit the surrounding product form.
              if (event.key === 'Enter') {
                event.preventDefault();
                void create();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
            placeholder="Название категории"
            className="min-h-11 flex-1 border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !name.trim()}
            className="min-h-11 whitespace-nowrap bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:opacity-50"
          >
            {saving ? 'Создание…' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="min-h-11 whitespace-nowrap border border-[var(--erp-divider)] px-3 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--erp-muted)]">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          id={id}
          ref={selectRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 flex-1 border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
        >
          <option value="">Без категории</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-11 whitespace-nowrap border border-[var(--erp-divider)] px-3 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          + Новая
        </button>
      </div>
    </div>
  );
}
