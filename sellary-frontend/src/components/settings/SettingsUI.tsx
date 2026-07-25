'use client';

import type { ReactNode } from 'react';

/**
 * One vocabulary for every control on the settings screen (DESIGN.md §5):
 * square corners, 1px hairline borders, Register Blue as the only accent,
 * 44px minimum on anything you can press, and a focus ring that is never
 * removed. Import these instead of hand-rolling a card or a button — the page
 * used to mix `rounded-2xl` shadow cards with square `border-2` ones because
 * there was nothing shared to reach for.
 */

/**
 * Membership roles come off the wire as `admin | manager | cashier`. The wire
 * values are what we send back; these are what a Russian-speaking shop owner
 * reads.
 */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  cashier: 'Кассир',
};

/** Focus ring for controls that sit flush inside a border (inputs, rows). */
export const controlFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]';

/** Focus ring for free-standing controls (buttons, chips). */
export const buttonFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]';

export const inputClass = `h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm text-[var(--erp-text)] ${controlFocus}`;

export const selectClass = `h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm text-[var(--erp-text)] ${controlFocus}`;

export const textareaClass = `w-full resize-y border border-[var(--erp-divider)] bg-white px-3 py-2 text-sm leading-snug text-[var(--erp-text)] ${controlFocus}`;

const buttonBase = `inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonFocus}`;

export const primaryButtonClass = `${buttonBase} bg-[var(--erp-accent)] text-white hover:bg-[var(--erp-accent-strong)]`;

export const secondaryButtonClass = `${buttonBase} border border-[var(--erp-divider)] bg-white text-[var(--erp-text)] hover:border-[var(--erp-text)]`;

/** Solid red is for a confirmed destructive step only (DESIGN.md §2). */
export const dangerButtonClass = `${buttonBase} bg-red-600 text-white hover:bg-red-700`;

/**
 * A settings card. `title` renders as an `<h3>`: the page owns the single
 * `<h1>` and each section panel owns its `<h2>`, so cards start at level 3.
 */
export function SettingsCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-[var(--erp-divider)] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--erp-divider)] px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-extrabold tracking-tight text-[var(--erp-text)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 max-w-[68ch] text-[13px] leading-snug text-[var(--erp-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

/**
 * A labelled form field. The label is a real `<label htmlFor>` — a placeholder
 * disappears on the first keystroke and screen readers announce the field as
 * blank, so placeholders here only ever illustrate a format.
 */
export function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-[var(--erp-text)]">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] leading-snug text-[var(--erp-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A switch row. The whole row is the target (well past 44px on a phone), and
 * state is carried by a word as well as by colour — an on/off track alone is
 * a hue-only signal.
 */
export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // Pins the accessible name to the label alone: the description below it
      // would otherwise be read out as part of the control's name.
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-[44px] w-full items-center justify-between gap-4 border border-[var(--erp-divider)] bg-white px-3 py-2.5 text-left transition-colors hover:border-[var(--erp-text)] disabled:cursor-not-allowed disabled:opacity-50 ${controlFocus}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--erp-text)]">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-[var(--erp-muted)]">
            {description}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`text-[12px] font-semibold ${
            checked ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'
          }`}
        >
          {checked ? 'Вкл' : 'Выкл'}
        </span>
        <span
          aria-hidden="true"
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-muted)]'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </span>
    </button>
  );
}

export type StatusTone = 'ok' | 'idle' | 'warn' | 'danger';

const TONE_TEXT: Record<StatusTone, string> = {
  ok: 'text-[var(--erp-success)]',
  idle: 'text-[var(--erp-muted)]',
  warn: 'text-[var(--erp-warn)]',
  danger: 'text-red-700',
};

const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-[var(--erp-success)]',
  idle: 'bg-[var(--erp-muted)]',
  warn: 'bg-[var(--erp-warn)]',
  danger: 'bg-red-700',
};

/**
 * Status chip. White fill so the coloured text clears AA on every surface the
 * chip lands on, plus a dot so the state is not carried by hue alone.
 */
export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border border-[var(--erp-divider)] bg-white px-2 py-1 text-[11px] font-semibold ${TONE_TEXT[tone]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

/** A quiet key/value row, for read-only facts (company identity, versions). */
export function FactRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--erp-divider)] py-2.5 last:border-b-0">
      <dt className="text-[13px] text-[var(--erp-muted)]">{term}</dt>
      <dd className="min-w-0 text-[13px] font-semibold text-[var(--erp-text)]">{children}</dd>
    </div>
  );
}
