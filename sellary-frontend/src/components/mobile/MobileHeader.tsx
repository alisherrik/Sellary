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
    <header className="flex h-[44px] shrink-0 items-center justify-between border-b-2 border-[var(--erp-divider)] bg-white px-4">
      <div className="flex w-10 items-center">
        {showBack && (
          <button
            onClick={onBack}
            className="-ml-1 flex h-9 w-9 items-center justify-center hover:bg-[var(--erp-surface)]"
            aria-label="Назад"
          >
            <ChevronLeftIcon className="h-5 w-5 text-[var(--erp-text)]" />
          </button>
        )}
      </div>
      <h1 className="text-[15px] font-extrabold tracking-tight text-[var(--erp-text)]">{title}</h1>
      <div className="flex w-10 items-center justify-end">{actions}</div>
    </header>
  );
}
