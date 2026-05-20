'use client';

import { ReactNode } from 'react';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  actions?: ReactNode;
}

export default function MobileHeader({
  title,
  showBack = false,
  onBack,
  actions,
}: MobileHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
      <div className="flex w-10 items-center">
        {showBack && (
          <button
            onClick={onBack}
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100"
            aria-label="Назад"
          >
            <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
          </button>
        )}
      </div>
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      <div className="flex w-10 items-center justify-end">{actions}</div>
    </header>
  );
}
