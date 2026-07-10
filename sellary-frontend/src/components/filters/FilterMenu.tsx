'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface FilterMenuProps {
  activeCount?: number;
  align?: 'left' | 'right';
  applyLabel?: string;
  children: ReactNode;
  className?: string;
  onReset?: () => void;
  panelClassName?: string;
  resetLabel?: string;
  title?: string;
}

export default function FilterMenu({
  activeCount = 0,
  align = 'right',
  applyLabel = 'Применить',
  children,
  className = '',
  onReset,
  panelClassName = '',
  resetLabel = 'Сбросить',
  title = 'Фильтры',
}: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  const handlePanelClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-filter-close]')) {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={title}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:px-3.5"
      >
        <FunnelIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{title}</span>
        {activeCount > 0 && (
          <span
            aria-hidden="true"
            className="grid min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold leading-5 text-white"
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Закрыть фильтры"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70] bg-black/30 sm:hidden"
          />
          <div
            id={panelId}
            role="dialog"
            aria-label={title}
            onClick={handlePanelClick}
            className={`fixed inset-x-3 bottom-3 z-[80] max-h-[82vh] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:absolute sm:bottom-auto sm:inset-x-auto sm:top-12 sm:w-80 sm:rounded-xl ${
              align === 'right' ? 'sm:right-0' : 'sm:left-0'
            } ${panelClassName}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{title}</p>
                {activeCount > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    Активно: {activeCount}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Закрыть фильтры"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[58vh] overflow-y-auto px-4 py-4 sm:max-h-[min(60vh,420px)]">
              {children}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
              {onReset ? (
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                >
                  {resetLabel}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {applyLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
