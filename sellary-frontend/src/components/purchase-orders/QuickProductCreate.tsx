'use client';

import { useState } from 'react';

import { productsApi } from '@/lib/api';
import type { Product } from '@/lib/types';

// Same vocabulary the product form offers, so a product created here is not a
// second-class citizen with a unit nobody else uses.
const UOM_OPTIONS = [
  { value: 'dona', label: 'шт' },
  { value: 'kg', label: 'кг' },
  { value: 'litr', label: 'л' },
  { value: 'metr', label: 'м' },
  { value: 'juft', label: 'пара' },
  { value: 'quti', label: 'коробка' },
  { value: 'komplekt', label: 'комплект' },
];

interface QuickProductCreateProps {
  /** What the buyer typed and could not find — the product's name, most likely. */
  initialName: string;
  onCancel: () => void;
  onCreated: (product: Product) => void;
}

/**
 * Creates a product without leaving the purchase order.
 *
 * A delivery arrives with something not yet in the catalogue perhaps every
 * other time. Sending the buyer to /products to add it loses the order they
 * were typing, so this asks for the four fields the API actually requires and
 * hands the product straight back to the line they were filling in.
 */
export default function QuickProductCreate({
  initialName,
  onCancel,
  onCreated,
}: QuickProductCreateProps) {
  const [name, setName] = useState(initialName);
  const [uom, setUom] = useState('dona');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название товара');
      return;
    }
    if (costPrice === '' || Number(costPrice) < 0) {
      setError('Введите себестоимость');
      return;
    }
    if (sellPrice === '' || Number(sellPrice) < 0) {
      setError('Введите цену продажи');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await productsApi.create({
        name: trimmed,
        uom,
        cost_price: costPrice,
        sell_price: sellPrice,
        // Stock stays at zero on purpose: the receipt is what puts it there.
        stock_quantity: '0',
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
      });
      onCreated(response.data as Product);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Не удалось создать товар');
    } finally {
      setSaving(false);
    }
  };

  const field =
    'min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]';
  const labelClass = 'mb-1 block text-xs font-medium text-[var(--erp-muted)]';

  return (
    <div
      className="p-3"
      onKeyDown={(event) => {
        // The purchase-order form is an ancestor; neither key may reach it.
        // But preventDefault() on a button's Enter suppresses its click, so
        // Enter on "Отмена" used to create the product instead of cancelling.
        if (event.key === 'Enter') {
          const tag = (event.target as HTMLElement).tagName;
          if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') {
            return;
          }
          event.preventDefault();
          void submit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--erp-muted)]">
        Новый товар
      </p>

      <div className="space-y-2.5">
        <label className="block">
          <span className={labelClass}>Название</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className={labelClass}>Единица</span>
            <select value={uom} onChange={(e) => setUom(e.target.value)} className={field}>
              {UOM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Штрихкод</span>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="необязательно"
              className={field}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className={labelClass}>Себестоимость</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.0001"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              className={`${field} text-right tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Цена продажи</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.0001"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className={`${field} text-right tabular-nums`}
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[#dc2626]">
          {error}
        </p>
      )}

      <p className="mt-2 text-xs text-[var(--erp-muted)]">
        Остаток останется нулевым — его добавит приёмка этой закупки.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="min-h-11 flex-1 bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:opacity-50"
        >
          {saving ? 'Создание…' : 'Создать и выбрать'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 border border-[var(--erp-divider)] px-4 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
