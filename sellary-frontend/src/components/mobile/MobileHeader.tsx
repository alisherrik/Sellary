'use client';

import { ReactNode } from 'react';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Rendered in the left slot when there is no back button (e.g. the /apps launcher link). */
  leading?: ReactNode;
  actions?: ReactNode;
}

export default function MobileHeader({
  title,
  showBack = false,
  onBack,
  leading,
  actions,
}: MobileHeaderProps) {
  // pt-safe: with viewport-fit=cover the status bar overlays the page, so the
  // header insets itself or the title sits under the notch. Height is a
  // minimum, not fixed, so the inset adds to it instead of eating the row.
  return (
    <header className="flex min-h-[48px] shrink-0 items-center justify-between border-b-2 border-[var(--erp-divider)] bg-white pl-1 pr-1 pt-safe">
      <div className="flex min-w-[44px] items-center">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 w-11 items-center justify-center hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
            aria-label="Назад"
          >
            <ChevronLeftIcon className="h-5 w-5 text-[var(--erp-text)]" />
          </button>
        ) : (
          leading
        )}
      </div>
      <h1 className="truncate px-1 text-[15px] font-extrabold tracking-tight text-[var(--erp-text)]">
        {title}
      </h1>
      <div className="flex min-w-[44px] items-center justify-end gap-1">{actions}</div>
    </header>
  );
}
