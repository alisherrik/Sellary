'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal bottom sheet for the mobile shell: dialog semantics, Escape, a focus
 * trap, focus return to whatever opened it, and a body scroll lock. Every
 * sheet in the shell goes through here so the keyboard/screen-reader contract
 * is identical wherever one appears.
 */
export default function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Move focus into the sheet on open, and hand it back to the opener (the
  // tab-bar button) on close — otherwise a keyboard user is dropped at the
  // top of the document.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables || focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // The shell is h-dvh, so `body` never scrolls — locking it is a no-op. The
  // real scroller is the shell's content <main>; lock that, and fall back to
  // body for sheets opened outside the shell.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const scroller =
      document.querySelector<HTMLElement>('[data-shell-scroll]') ?? document.body;
    const previousOverflow = scroller.style.overflow;
    scroller.style.overflow = 'hidden';
    return () => {
      scroller.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 touch-none overscroll-contain bg-black/50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto animate-slide-up border-t-2 border-[var(--erp-divider)] bg-white pb-safe outline-none"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--erp-divider)] bg-white pl-4 pr-1">
          <h2
            id={titleId}
            className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-[var(--erp-accent)]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-11 w-11 items-center justify-center text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
