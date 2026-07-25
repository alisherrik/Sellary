'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import type { SaleSearchSuggestion } from '@/lib/types';

interface SalesSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
  suggestions: SaleSearchSuggestion[];
  isLoading: boolean;
  isSearching?: boolean;
}

const KIND_LABELS: Record<SaleSearchSuggestion['kind'], string> = {
  product: 'Товар',
  cashier: 'Кассир',
  customer: 'Клиент',
  status: 'Статус',
  payment: 'Оплата',
};

export default function SalesSearch({
  value,
  onChange,
  onSelect,
  suggestions,
  isLoading,
  isSearching = false,
}: SalesSearchProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(value.trim().length >= 2);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  const showPanel =
    open && value.trim().length >= 2 && (isLoading || suggestions.length > 0);

  const selectSuggestion = (suggestion: SaleSearchSuggestion) => {
    onSelect(suggestion.value);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!suggestions.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  };

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--erp-muted)]" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Поиск продаж"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Поиск по чеку, товару, кассиру, сумме..."
          className="h-10 w-full border border-[var(--erp-divider)] bg-white py-2 pl-9 pr-16 text-sm text-[var(--erp-text)] outline-none transition focus:border-[var(--erp-text)]"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {isSearching && (
            <ArrowPathIcon
              aria-label="Поиск продаж..."
              className="h-4 w-4 animate-spin text-blue-500"
            />
          )}
          {value && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                onChange('');
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="p-1 text-[var(--erp-muted)] hover:text-[var(--erp-text)]"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showPanel && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden border border-[var(--erp-divider)] bg-white shadow-xl">
          <div className="border-b border-[var(--erp-divider)] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--erp-muted)]">
            Возможно, вы искали
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Ищем похожие варианты...
            </div>
          ) : (
            <ul id={listboxId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {suggestions.map((suggestion, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={`${suggestion.kind}-${suggestion.value}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm ${
                    activeIndex === index
                      ? 'bg-[var(--erp-surface)] text-[var(--erp-text)]'
                      : 'text-gray-700 hover:bg-[var(--erp-surface)]'
                  }`}
                >
                  <span className="min-w-0 truncate font-medium">{suggestion.label}</span>
                  <span className="shrink-0 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                    {KIND_LABELS[suggestion.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
