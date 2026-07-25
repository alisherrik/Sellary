'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes a dialog behave like one for the keyboard.
 *
 * `role="dialog" aria-modal="true"` is a promise to assistive technology and
 * nothing more — it never constrains Tab. Several money dialogs here announced
 * themselves and then let the keyboard walk straight out into the table behind
 * the scrim, with no way to dismiss. This gives them initial focus, a Tab
 * cycle, Escape, and focus returned to whatever opened them.
 *
 * Initial focus prefers the first input: in this product a dialog almost always
 * opens because the user is about to type an amount.
 */
export function useDialogFocus(
  panelRef: RefObject<HTMLElement>,
  open: boolean,
  onClose?: () => void,
) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) {
      return;
    }

    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    (panel.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])') ??
      focusables()[0] ??
      panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();
      if (!items.length) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
    // `onClose` is deliberately not a dependency: callers pass inline arrows,
    // and re-running this effect on every parent render would yank focus back
    // to the opener mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelRef]);
}
