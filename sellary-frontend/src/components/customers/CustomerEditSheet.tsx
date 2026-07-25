'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';

import { customersApi } from '@/lib/api';
import type { Customer } from '@/lib/types';

interface CustomerEditSheetProps {
  customer: Customer;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edit a customer's details.
 *
 * A customer could be created — from the register's quick-add, mid-sale, in a
 * hurry — and then never corrected. A phone number typed wrong stayed wrong
 * forever, on the record you use to chase a debt.
 */
export default function CustomerEditSheet({
  customer,
  onClose,
  onSaved,
}: CustomerEditSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(customer.name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [description, setDescription] = useState(customer.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) {
      setError('Введите имя клиента');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await customersApi.update(customer.id, {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        description: description.trim() || null,
      });
      toast.success('Клиент обновлён');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Не удалось сохранить клиента');
    } finally {
      setSaving(false);
    }
  };

  const field =
    'min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]';
  const labelClass = 'mb-1 block text-xs font-medium text-[var(--erp-muted)]';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-edit-title"
        tabIndex={-1}
        className="relative w-full max-w-[480px] border-2 border-[var(--erp-divider)] bg-white outline-none"
      >
        <div className="flex items-center justify-between border-b-2 border-[var(--erp-divider)] pl-4 pr-1">
          <h2
            id="customer-edit-title"
            className="py-3 text-[15px] font-extrabold tracking-tight text-[var(--erp-text)]"
          >
            Данные клиента
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid h-11 w-11 place-items-center text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2.5 p-4">
          <label className="block">
            <span className={labelClass}>Имя</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className={labelClass}>Телефон</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Заметка</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${field} py-2`}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-[#dc2626]">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="min-h-11 flex-1 bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:opacity-50"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 border border-[var(--erp-divider)] px-4 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
