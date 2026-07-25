'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';

import { productsApi } from '@/lib/api';
import type { Product } from '@/lib/types';
import QuickProductCreate from './QuickProductCreate';
import { formatCurrency } from '@/lib/utils';

interface ProductComboboxProps {
  value: Product | null;
  excludedProductIds: Set<number>;
  error?: string;
  errorId?: string;
  onSelect: (product: Product) => void;
  label?: string;
}

export default function ProductCombobox({
  value,
  excludedProductIds,
  error,
  errorId,
  onSelect,
  label = 'Товар',
}: ProductComboboxProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value?.name ?? '');
  const [options, setOptions] = useState<Product[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  creatingRef.current = creating;

  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value?.id, value?.name]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === value?.name) {
      setOptions([]);
      setRequestError('');
      return;
    }

    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setRequestError('');
      try {
        const response = await productsApi.search(trimmed);
        setOptions(response.data);
        setActiveIndex(0);
        setIsOpen(true);
      } catch {
        setOptions([]);
        setRequestError('Не удалось загрузить товары');
        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query, value?.name]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      // A half-typed new product must not be thrown away by a stray click —
      // only the panel's own Отмена leaves that state.
      if (creatingRef.current) return;
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const activeOptionId = useMemo(
    () => (isOpen && options[activeIndex] ? `${id}-option-${options[activeIndex].id}` : undefined),
    [activeIndex, id, isOpen, options],
  );

  const select = (product: Product) => {
    onSelect(product);
    setQuery(product.name);
    setIsOpen(false);
    setCreating(false);
    // Closing the create panel unmounted the button that had focus, dropping
    // it to <body>; the next Tab restarted at the top of the document.
    inputRef.current?.focus();
  };

  const trimmedQuery = query.trim();
  const canCreate = trimmedQuery.length >= 2 && !isLoading && !requestError;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <MagnifyingGlassIcon
        className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--erp-muted)]"
        aria-hidden="true"
      />
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={activeOptionId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        value={query}
        onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(event.target.value.trim().length >= 2);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsOpen(false);
          if (!isOpen || !options.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, options.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            select(options[activeIndex]);
          }
        }}
        placeholder="Название или штрихкод"
        className={`min-h-11 w-full border bg-white py-2 pl-9 pr-3 text-sm text-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] ${
          error ? 'border-[#dc2626]' : 'border-[var(--erp-divider)]'
        }`}
      />

      {/* Typing a barcode used to be silent to a screen reader: the three
          result states were plain paragraphs with no live region. */}
      <span className="sr-only" role="status" aria-live="polite">
        {isOpen && !isLoading && !requestError && options.length > 0
          ? `Найдено ${options.length} товаров`
          : ''}
      </span>

      {isOpen && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto border-2 border-[var(--erp-divider)] bg-white py-1 sm:min-w-72"
        >
          {creating ? (
            <QuickProductCreate
              initialName={trimmedQuery}
              onCancel={() => {
                setCreating(false);
                inputRef.current?.focus();
              }}
              onCreated={select}
            />
          ) : isLoading ? (
            <p role="status" className="px-3 py-3 text-sm text-[var(--erp-muted)]">Загрузка…</p>
          ) : requestError ? (
            <p role="alert" className="px-3 py-3 text-sm text-[#dc2626]">{requestError}</p>
          ) : options.length ? (
            options.map((product, index) => (
              <button
                id={`${id}-option-${product.id}`}
                key={product.id}
                type="button"
                role="option"
                // DOM focus stays in the input; the listbox is driven by
                // aria-activedescendant. A tabbable option here landed keyboard
                // users on an invisible control.
                tabIndex={-1}
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(product)}
                className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? 'bg-[var(--erp-surface)] ring-1 ring-inset ring-[var(--erp-accent)]'
                    : 'hover:bg-[var(--erp-surface)]'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--erp-text)]">
                    {product.name}
                  </span>
                  <span className="block text-xs text-[var(--erp-muted)]">
                    {[product.barcode, product.uom].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums text-[var(--erp-text)]">
                    {formatCurrency(product.cost_price)}
                  </span>
                  {excludedProductIds.has(product.id) && (
                    <span className="block text-xs text-[#dc2626]">Уже добавлен</span>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p role="status" className="px-3 py-3 text-sm text-[var(--erp-muted)]">Товары не найдены</p>
          )}

          {/* A delivery routinely contains something not yet in the catalogue.
              Sending the buyer to /products to add it loses the order. */}
          {!creating && canCreate && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-11 w-full items-center gap-2 border-t border-[var(--erp-divider)] px-3 text-left text-sm font-semibold text-[var(--erp-accent)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
            >
              <PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Создать «{trimmedQuery}»</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
