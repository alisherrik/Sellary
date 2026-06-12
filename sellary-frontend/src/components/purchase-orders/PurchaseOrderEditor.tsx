'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/20/solid';

import {
  buildPurchaseOrderPayload,
  createEmptyPurchaseOrderForm,
  hasPurchaseOrderErrors,
  mapPurchaseOrderToForm,
  validatePurchaseOrderForm,
  type PurchaseOrderFormData,
  type PurchaseOrderFormErrors,
} from '@/features/purchase-orders/purchaseOrderForm';
import type { Product, PurchaseOrder, PurchaseOrderPayload, Supplier } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import PurchaseOrderItemsTable from './PurchaseOrderItemsTable';
import PurchaseOrderStatusBadge from './PurchaseOrderStatusBadge';
import PurchaseOrderStepper, { type PurchaseOrderStep } from './PurchaseOrderStepper';
import PurchaseOrderSummary from './PurchaseOrderSummary';

interface PurchaseOrderEditorProps {
  initialOrder?: PurchaseOrder;
  suppliers: Supplier[];
  onSave: (payload: PurchaseOrderPayload, id?: number) => Promise<PurchaseOrder>;
  onSend: (id: number) => Promise<PurchaseOrder>;
  onComplete: (order: PurchaseOrder) => void;
  onCancel?: () => void;
}

const emptyErrors = (): PurchaseOrderFormErrors => ({ items: {} });

export default function PurchaseOrderEditor({
  initialOrder,
  suppliers,
  onSave,
  onSend,
  onComplete,
  onCancel,
}: PurchaseOrderEditorProps) {
  const [form, setForm] = useState<PurchaseOrderFormData>(() =>
    initialOrder ? mapPurchaseOrderToForm(initialOrder) : createEmptyPurchaseOrderForm(),
  );
  const [currentStep, setCurrentStep] = useState<PurchaseOrderStep>('supplier');
  const [errors, setErrors] = useState<PurchaseOrderFormErrors>(emptyErrors);
  const [requestError, setRequestError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === Number(form.supplier_id),
  );

  const productsById = useMemo(() => {
    const products = new Map<number, Product>();
    initialOrder?.items.forEach((item) => {
      if (!item.product) return;
      products.set(item.product_id, {
        id: item.product_id,
        barcode: item.product.barcode,
        name: item.product.name,
        product_type: 'item',
        uom: item.product.uom ?? 'шт',
        cost_price: String(item.unit_cost),
        sell_price: '0',
        tax_percent: '0',
        stock_quantity: 0,
        min_stock_level: 0,
        is_active: true,
        created_at: initialOrder.created_at,
      });
    });
    return products;
  }, [initialOrder]);

  const updateForm = (changes: Partial<PurchaseOrderFormData>) => {
    setForm((current) => ({ ...current, ...changes }));
    setIsDirty(true);
    setRequestError('');
  };

  const focusFirstError = () => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-error="true"]')?.focus();
    });
  };

  const validateSupplier = () => {
    if (Number(form.supplier_id)) return true;
    setErrors({ items: {}, supplier_id: 'Выберите поставщика' });
    focusFirstError();
    return false;
  };

  const validateAll = () => {
    const nextErrors = validatePurchaseOrderForm(form);
    setErrors(nextErrors);
    if (hasPurchaseOrderErrors(nextErrors)) {
      focusFirstError();
      return false;
    }
    return true;
  };

  const changeStep = (step: PurchaseOrderStep) => {
    if (step === 'receive') return;
    if (step !== 'supplier' && !validateSupplier()) return;
    if (step === 'review' && !validateAll()) return;
    setErrors(emptyErrors());
    setCurrentStep(step);
  };

  const saveDraft = useCallback(
    async (finish: boolean) => {
      const nextErrors = validatePurchaseOrderForm(form);
      setErrors(nextErrors);
      if (hasPurchaseOrderErrors(nextErrors)) {
        focusFirstError();
        return null;
      }

      setIsSubmitting(true);
      setRequestError('');
      try {
        const saved = await onSave(buildPurchaseOrderPayload(form), initialOrder?.id);
        setIsDirty(false);
        if (finish) onComplete(saved);
        return saved;
      } catch {
        setRequestError('Не удалось сохранить закупку. Проверьте соединение и попробуйте снова.');
        return null;
      } finally {
        setIsSubmitting(false);
      }
    }, [form, initialOrder?.id, onComplete, onSave],
  );

  const saveAndSend = async () => {
    const saved = await saveDraft(false);
    if (!saved) return;
    setIsSubmitting(true);
    setRequestError('');
    try {
      const sent = await onSend(saved.id);
      setIsDirty(false);
      onComplete(sent);
    } catch {
      setRequestError('Закупка сохранена, но не отправлена. Попробуйте отправить её ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty || isSubmitting) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, isSubmitting]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDraft(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [saveDraft]);

  if (initialOrder && initialOrder.status !== 'draft') {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        Эту закупку нельзя редактировать, потому что её статус изменился.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            Закупки / {initialOrder ? `#${initialOrder.id}` : 'Новая закупка'}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
            {initialOrder ? `Редактирование закупки #${initialOrder.id}` : 'Новая закупка'}
          </h1>
        </div>
        <PurchaseOrderStatusBadge status="draft" />
      </div>

      <div className="border-y border-gray-200 bg-white py-4">
        <PurchaseOrderStepper
          mode="editor"
          currentStep={currentStep}
          status="draft"
          onStepChange={changeStep}
        />
      </div>

      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <section className="min-w-0 bg-white">
          {currentStep === 'supplier' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Поставщик</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Укажите контрагента и ожидаемую дату поставки.
                </p>
              </div>
              <label className="block max-w-xl">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">
                  Поставщик <span className="text-red-600">*</span>
                </span>
                <select
                  value={form.supplier_id}
                  data-error={Boolean(errors.supplier_id)}
                  aria-invalid={Boolean(errors.supplier_id)}
                  onChange={(event) => {
                    updateForm({ supplier_id: event.target.value });
                    setErrors((current) => ({ ...current, supplier_id: undefined }));
                  }}
                  className={`min-h-11 w-full rounded-md border bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                    errors.supplier_id ? 'border-red-500' : 'border-gray-300'
                  }`}
                >
                  <option value="">Выберите поставщика</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {errors.supplier_id && (
                  <p className="mt-1 text-xs text-red-600">{errors.supplier_id}</p>
                )}
              </label>
              <label className="block max-w-sm">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">
                  Ожидаемая дата
                </span>
                <input
                  type="date"
                  value={form.expected_delivery_date}
                  onChange={(event) => updateForm({ expected_delivery_date: event.target.value })}
                  className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </label>
              <label className="block max-w-2xl">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">
                  Примечание
                </span>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(event) => updateForm({ notes: event.target.value })}
                  placeholder="Условия поставки, контакт или внутренний комментарий"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </label>
            </div>
          )}

          {currentStep === 'items' && (
            <div>
              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900">Товары</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Найдите товар по названию или штрихкоду и проверьте закупочную цену.
                </p>
              </div>
              <PurchaseOrderItemsTable
                items={form.items}
                productsById={productsById}
                errors={errors.items}
                onChange={(items) => updateForm({ items })}
              />
            </div>
          )}

          {currentStep === 'review' && (
            <div>
              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900">Проверка</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Проверьте детали перед сохранением или отправкой поставщику.
                </p>
              </div>
              <dl className="grid gap-4 border-y border-gray-200 py-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-gray-500">Поставщик</dt>
                  <dd className="mt-1 font-semibold text-gray-900">{selectedSupplier?.name}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Дата поставки</dt>
                  <dd className="mt-1 font-semibold text-gray-900">
                    {form.expected_delivery_date || 'Не указана'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Примечание</dt>
                  <dd className="mt-1 font-semibold text-gray-900">
                    {form.notes || 'Нет'}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 divide-y divide-gray-200">
                {form.items.map((item) => {
                  const product = productsById.get(Number(item.product_id));
                  return (
                    <div key={item.key} className="flex items-center justify-between gap-4 py-3 text-sm">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {product?.name ?? `Товар #${item.product_id}`}
                        </p>
                        <p className="text-gray-500">
                          {item.quantity_ordered} {product?.uom ?? 'ед.'} × {formatCurrency(item.unit_cost)}
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums text-gray-900">
                        {formatCurrency(Number(item.quantity_ordered) * Number(item.unit_cost))}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {requestError && (
            <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {requestError}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 py-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDirty && !window.confirm('Есть несохранённые изменения. Выйти?')) return;
                  onCancel?.();
                }}
                className="min-h-11 rounded-md px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100"
              >
                Отмена
              </button>
              {currentStep !== 'supplier' && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(currentStep === 'review' ? 'items' : 'supplier')}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <ArrowLeftIcon className="h-4 w-4" /> Назад
                </button>
              )}
            </div>

            {currentStep === 'supplier' && (
              <button
                type="button"
                onClick={() => changeStep('items')}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Продолжить <ArrowRightIcon className="h-4 w-4" />
              </button>
            )}
            {currentStep === 'items' && (
              <button
                type="button"
                onClick={() => changeStep('review')}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Продолжить к проверке <ArrowRightIcon className="h-4 w-4" />
              </button>
            )}
            {currentStep === 'review' && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void saveDraft(true)}
                  className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Сохранить черновик
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void saveAndSend()}
                  className="min-h-11 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Отправить поставщику
                </button>
              </div>
            )}
          </div>
        </section>

        <PurchaseOrderSummary form={form} supplier={selectedSupplier} />
      </div>
    </div>
  );
}
