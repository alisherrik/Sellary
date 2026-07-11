import type { FormEvent, RefObject } from 'react';
import { MagnifyingGlassIcon, QrCodeIcon } from '@heroicons/react/24/outline';

interface SearchBarProps {
  search: string;
  onSearch: (value: string) => void;
  barcode: string;
  onBarcode: (value: string) => void;
  onBarcodeSubmit: (e: FormEvent) => void;
  barcodeRef: RefObject<HTMLInputElement | null>;
}

export function SearchBar({
  search, onSearch, barcode, onBarcode, onBarcodeSubmit, barcodeRef,
}: SearchBarProps) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Поиск товара…"
          className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>
      <form onSubmit={onBarcodeSubmit} className="relative w-52">
        <QrCodeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          ref={barcodeRef}
          type="text"
          value={barcode}
          onChange={(e) => onBarcode(e.target.value)}
          placeholder="Штрихкод (F2)"
          className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 font-mono text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </form>
    </div>
  );
}
