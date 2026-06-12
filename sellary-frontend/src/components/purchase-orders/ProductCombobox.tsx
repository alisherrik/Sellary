'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';

import { productsApi } from '@/lib/api';
import type { Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface ProductComboboxProps {
  value: Product | null;
  excludedProductIds: Set<number>;
  error?: string;
  onSelect: (product: Product) => void;
  label?: string;
}

export default function ProductCombobox({
  value,
  excludedProductIds,
  error,
  onSelect,
  label = 'Товар',
}: ProductComboboxProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value?.name ?? '');
  const [options, setOptions] = useState<Product[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

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
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <MagnifyingGlassIcon
        className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400"
        aria-hidden="true"
      />
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={activeOptionId}
        aria-invalid={Boolean(error)}
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
        className={`min-h-11 w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
      />

      {isOpen && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {isLoading ? (
            <p className="px-3 py-3 text-sm text-gray-500">Загрузка...</p>
          ) : requestError ? (
            <p className="px-3 py-3 text-sm text-red-600">{requestError}</p>
          ) : options.length ? (
            options.map((product, index) => (
              <button
                id={`${id}-option-${product.id}`}
                key={product.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(product)}
                className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm ${
                  index === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">
                    {product.name}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {[product.barcode, product.uom].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums text-gray-700">
                    {formatCurrency(product.cost_price)}
                  </span>
                  {excludedProductIds.has(product.id) && (
                    <span className="block text-xs text-red-600">Уже добавлен</span>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-gray-500">Товары не найдены</p>
          )}
        </div>
      )}
    </div>
  );
}
