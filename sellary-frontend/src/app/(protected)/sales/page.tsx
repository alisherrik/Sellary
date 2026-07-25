'use client';

import { useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import toast from 'react-hot-toast';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  PrinterIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { salesApi, metaApi, customersApi, generateIdempotencyKey } from '@/lib/api';
import { formatCurrency, printReceipt } from '@/lib/utils';
import { TableSkeleton } from '@/components/skeletons';
import FilterMenu from '@/components/filters/FilterMenu';
import { ModuleGuard } from '@/components/ModuleGuard';
import QueryError from '@/components/ui/QueryError';
import AnnulmentDialog from '@/components/transactions/AnnulmentDialog';
import { Sale, SaleItem, VoidPreview } from '@/lib/types';
import { useModules } from '@/lib/store';
import { canAccessModule } from '@/lib/modules';
import { useDebounce } from '@/hooks/useDebounce';
import { useSaleSearchSuggestions, useInfiniteSales, useSalesSummary } from '@/hooks/useQueries';
import SalesSearch from '@/components/sales/SalesSearch';
import { parseEditableAmount } from '@/lib/posPricing';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface SaleReturnItem {
  id: number;
  sale_item_id: number;
  product_name: string;
  quantity_returned: number;
  refund_amount: string;
}

interface SaleReturn {
  id: number;
  sale_id: number;
  user_id: number;
  user_name: string;
  total_refund_amount: string;
  refund_method: string;
  notes?: string;
  created_at: string;
  items: SaleReturnItem[];
}

interface ReturnQuantity {
  saleItemId: number;
  quantity: number;
  maxQuantity: number;
}

type StatusFilter = 'all' | 'completed' | 'returns' | 'cancelled';
type PaymentFilter = 'all' | Sale['payment_method'];

const paymentChip = (sale: Sale) => {
  const cardLabels: Record<string, string> = { alif: 'Alif', eskhata: 'Eskhata', dc: 'DC' };
  if (sale.payment_method === 'credit') {
    return {
      label: '🧾 В долг',
      cls: 'bg-[var(--erp-badge-bg)] text-[var(--erp-badge-text)]',
    };
  }
  if (sale.payment_method === 'card') {
    return {
      label: `💳 ${sale.card_type ? cardLabels[sale.card_type] ?? sale.card_type : 'Карта'}`,
      cls: 'bg-sky-50 text-sky-600',
    };
  }
  if (sale.payment_method === 'mobile') {
    return { label: '📱 Мобильный', cls: 'bg-violet-50 text-violet-600' };
  }
  return { label: '💵 Наличные', cls: 'bg-gray-100 text-gray-600' };
};

// Backend 403s carry a dict detail ({code, module, ...}); passing that to toast renders nothing.
const errorText = (detail: unknown, fallback: string) =>
  typeof detail === 'string' && detail ? detail : fallback;

const debtStatusText = (status?: Sale['payment_status']) => {
  const labels: Record<string, string> = {
    unpaid: 'Не оплачено',
    partial: 'Частично оплачено',
    paid: 'Оплачено',
    settled: 'Оплачено',
  };
  return labels[status || 'paid'] || status || 'Оплачено';
};

/**
 * One idempotency key per attempt at a thing, not per request.
 *
 * A key minted inside the submit handler is a new key on every press, so a
 * request that timed out after the server had already committed came back as
 * an unrelated one — and the refund, or the debt payment, was applied twice.
 * The key is held for as long as the dialog is open and cleared only on
 * success.
 */
function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null);
  const take = () => {
    if (!keyRef.current) {
      keyRef.current = generateIdempotencyKey();
    }
    return keyRef.current;
  };
  const reset = () => {
    keyRef.current = null;
  };
  return { take, reset };
}

/**
 * What the cashier actually sold, in the unit they sold it in.
 *
 * `quantity` is base units by contract while `unit_price` is per *sold* unit,
 * so pairing them rendered a box of 12 at 50 000 as "12 шт × 50 000" next to a
 * line total of 50 000 — on the screen a manager reads before authorising a
 * refund. The response carries sold_quantity and sold_unit_label for exactly
 * this; they were being ignored.
 */
const soldAs = (item: SaleItem) => ({
  quantity: item.sold_quantity ?? item.quantity,
  unit: item.sold_unit_label ?? item.uom,
});

/**
 * The return modal counts in the unit the customer bought in.
 *
 * `quantity_returnable` is base units by contract, so a box of 12 sold as one
 * box opened the return as "Доступно: 12" and stepped in twelfths — while the
 * detail pane one screen earlier said "1 кор". The manager authorising the
 * refund was reading two different numbers for the same thing. Display and
 * stepping happen in sold units; the payload still goes out in base.
 */
const soldFactor = (item?: SaleItem) => {
  const factor = Number(item?.sold_unit_factor ?? 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
};

const toSoldUnits = (baseQuantity: number, item?: SaleItem) =>
  Math.round((baseQuantity / soldFactor(item)) * 1000) / 1000;

const toBaseUnits = (soldQuantity: number, item?: SaleItem) =>
  Math.round(soldQuantity * soldFactor(item) * 1000) / 1000;

/**
 * A 409 from an idempotency conflict means the held key no longer describes
 * this request — the operator changed the amount or the quantities after a
 * failed attempt. Retire it, or the dialog is dead for that sale until a
 * reload, showing an untranslated server string.
 */
const isIdempotencyConflict = (error: any) =>
  error?.response?.status === 409 &&
  typeof error?.response?.data?.detail === 'string' &&
  error.response.data.detail.toLowerCase().includes('idempotency');

function SalesHistory() {
  const queryClient = useQueryClient();
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  // A swallowed error used to render "Возвратов нет" — telling a manager this
  // receipt has no refund history on the screen where they decide whether to
  // refund again.
  const [returnsFailed, setReturnsFailed] = useState(false);
  const [refundMethods, setRefundMethods] = useState<string[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<ReturnQuantity[]>([]);
  const [refundMethod, setRefundMethod] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [annulMode, setAnnulMode] = useState(false);
  const [voidPreview, setVoidPreview] = useState<VoidPreview | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [showDebtPaymentModal, setShowDebtPaymentModal] = useState(false);
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('');
  const [debtPaymentMethod, setDebtPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [debtPaymentDescription, setDebtPaymentDescription] = useState('');
  const [debtPaymentSubmitting, setDebtPaymentSubmitting] = useState(false);
  const modules = useModules();
  // Returns/voids need pos:manager on the backend; admin's modules map carries all modules at manager.
  const canManagePos = canAccessModule(modules, 'sales', 'manager');
  const debouncedSearch = useDebounce(searchInput, 300);

  const returnKey = useIdempotencyKey();
  const debtPaymentKey = useIdempotencyKey();
  const returnPanelRef = useRef<HTMLDivElement>(null);
  const debtPanelRef = useRef<HTMLDivElement>(null);
  const mobileDetailRef = useRef<HTMLDivElement>(null);

  useDialogFocus(returnPanelRef, showReturnModal, () => setShowReturnModal(false));
  useDialogFocus(debtPanelRef, showDebtPaymentModal, () => setShowDebtPaymentModal(false));
  // The mobile detail panel is mounted at every width and merely `lg:hidden`,
  // so on desktop the trap focused an element inside a display:none subtree —
  // a no-op that left focus on <body>.
  const isMobileViewport = useMediaQuery('(max-width: 1023px)');
  useDialogFocus(mobileDetailRef, showDetail && isMobileViewport, () => setShowDetail(false));

  const salesParams = useMemo(() => {
    const params: Record<string, string | number> = { limit: 200 };
    const search = debouncedSearch.trim();

    if (search) params.search = search;
    if (statusFilter === 'completed') params.status = 'completed';
    if (statusFilter === 'cancelled') params.status = 'cancelled';
    if (statusFilter === 'returns') params.status_group = 'returns';
    // Filtered server-side so the KPI cards reflect the choice: a client-side
    // filter would only narrow the page in hand, never the totals.
    if (paymentFilter !== 'all') params.payment_method = paymentFilter;
    if (startDate) params.start_date = `${startDate}T00:00:00`;
    if (endDate) params.end_date = `${endDate}T23:59:59`;

    return params;
  }, [debouncedSearch, statusFilter, paymentFilter, startDate, endDate]);

  const {
    sales = [],
    total,
    isLoading: loading,
    isError,
    isFetching,
    isFetchingNextPage,
    hasMore,
    loadMore,
    refetch,
  } = useInfiniteSales(salesParams);
  const { data: searchSuggestions = [], isLoading: suggestionsLoading } =
    useSaleSearchSuggestions(debouncedSearch);
  const suggestionsSettled = searchInput.trim() === debouncedSearch.trim();
  const visibleSales = sales;

  // Totals come from the server, over the WHOLE filtered history. Summing the
  // loaded rows here is what under-reported turnover: the list arrives 200 at a
  // time behind a manual "load more", so the card described a slice of the day.
  const { data: summary } = useSalesSummary(salesParams);
  const totals = useMemo(
    () => ({
      turnover: Number(summary?.turnover ?? 0),
      net: Number(summary?.net_turnover ?? 0),
      refunds: Number(summary?.refunds ?? 0),
      count: summary?.count ?? 0,
      avg: Number(summary?.average_check ?? 0),
      refundOps: summary?.refund_operations ?? 0,
      cash: Number(summary?.cash ?? 0),
      card: Number(summary?.card ?? 0),
      mobile: Number(summary?.mobile ?? 0),
      credit: Number(summary?.credit ?? 0),
      cashDebtPayments: Number(summary?.cash_debt_payments ?? 0),
    }),
    [summary],
  );

  const openVoidDialog = async (sale: Sale) => {
    setSelectedSale(sale);
    setVoidPreview(null);
    setShowVoidDialog(true);
    setVoidLoading(true);
    try {
      const response = await salesApi.previewVoid(sale.id);
      setVoidPreview(response.data);
    } catch (error: any) {
      toast.error(errorText(error.response?.data?.detail, 'Не удалось проверить аннулирование'));
      setShowVoidDialog(false);
    } finally {
      setVoidLoading(false);
    }
  };

  const confirmVoid = async (reason: string) => {
    if (!selectedSale) return;
    setVoidSubmitting(true);
    try {
      await salesApi.void(selectedSale.id, reason);
      toast.success('Продажа аннулирована, остатки восстановлены');
      setShowVoidDialog(false);
      setShowDetail(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error: any) {
      toast.error(
        errorText(
          error.response?.data?.detail?.message || error.response?.data?.detail,
          'Аннулирование не выполнено',
        ),
      );
    } finally {
      setVoidSubmitting(false);
    }
  };

  // Hourly turnover over the whole filtered history, bucketed by the server on
  // the company's clock. Reading the hour off the loaded rows here meant both
  // the same partial-page problem as the cards above, and the viewer's browser
  // timezone rather than the shop's.
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => 0);
    (summary?.hourly ?? []).forEach((bucket) => {
      buckets[bucket.hour] = Number(bucket.turnover || 0);
    });
    const start = 8;
    const end = 22;
    const slice = buckets.slice(start, end + 1).map((value, i) => ({ hour: start + i, value }));
    const max = Math.max(1, ...slice.map((b) => b.value));
    return { slice, max };
  }, [summary]);

  const returnMutation = useMutation({
    mutationFn: async (data: { saleId: number; payload: any; idempotencyKey: string; annul?: boolean }) =>
      salesApi.processReturn(data.saleId, data.payload, data.idempotencyKey),
    onSuccess: (_data, variables) => {
      toast.success(variables.annul ? 'Позиция аннулирована' : 'Возврат успешно оформлен');
      // Only a success retires the key: a failed attempt must be retryable as
      // the same operation, or a timeout refunds twice.
      returnKey.reset();
      setShowReturnModal(false);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowDetail(false);
    },
    onError: (error: any) => {
      if (isIdempotencyConflict(error)) {
        returnKey.reset();
        toast.error('Данные возврата изменились после сбоя. Повторите ещё раз.');
        return;
      }
      toast.error(errorText(error.response?.data?.detail, 'Ошибка при оформлении возврата'));
    },
  });

  const handleViewSale = async (sale: Sale) => {
    setSelectedSale(sale);
    setShowDetail(true);
    setReturnsLoading(true);
    setReturnsFailed(false);
    try {
      const res = await salesApi.getReturns(sale.id);
      setReturns(res.data);
    } catch {
      setReturnsFailed(true);
      setReturns([]);
    } finally {
      setReturnsLoading(false);
    }
  };

  const loadRefundMethods = async () => {
    try {
      const res = await metaApi.getSaleReturnOptions();
      setRefundMethods(res.data.refund_methods);
      setRefundMethod(res.data.refund_methods[0] || 'cash');
    } catch {
      setRefundMethods(['cash', 'card', 'mobile']);
      setRefundMethod('cash');
    }
  };

  const itemOutstanding = (item: any) =>
    item.quantity_returnable !== undefined
      ? Number(item.quantity_returnable)
      : Number(item.quantity) - Number(item.quantity_returned || 0);

  const handleOpenAnnulItem = async (sale: Sale, item: any) => {
    // Line-level annulment reuses the return flow: preselect ONLY this line,
    // fix the quantity to its full outstanding amount, and require a reason.
    const maxQty = itemOutstanding(item);
    if (maxQty <= 0) return;
    setSelectedSale(sale);
    setAnnulMode(true);
    setReturnNotes('');
    setReturnQuantities([{ saleItemId: item.id, quantity: maxQty, maxQuantity: maxQty }]);
    await loadRefundMethods();
    setShowDetail(false);
    setShowReturnModal(true);
  };

  const handleOpenReturnModal = async (sale: Sale) => {
    setSelectedSale(sale);
    setAnnulMode(false);
    setReturnNotes('');
    setReturnQuantities(
      sale.items
        .filter((item: any) => item.transaction_type === 'sale' && (item.quantity - (item.quantity_returned || 0)) > 0)
        .map((item: any) => {
          const maxQty =
            item.quantity_returnable !== undefined
              ? item.quantity_returnable
              : item.quantity - (item.quantity_returned || 0);
          return {
            saleItemId: item.id,
            quantity: 0,
            maxQuantity: maxQty,
          };
        })
        .filter((rq) => rq.maxQuantity > 0)
    );

    try {
      const res = await metaApi.getSaleReturnOptions();
      setRefundMethods(res.data.refund_methods);
      setRefundMethod(res.data.refund_methods[0] || 'cash');
    } catch {
      setRefundMethods(['cash', 'card', 'mobile']);
      setRefundMethod('cash');
    }

    setShowReturnModal(true);
  };

  const handleQuantityChange = (saleItemId: number, value: number) => {
    setReturnQuantities((prev) =>
      prev.map((rq) =>
        rq.saleItemId === saleItemId
          ? { ...rq, quantity: Math.min(Math.max(0, value), rq.maxQuantity) }
          : rq
      )
    );
  };

  const hasSelectedItems = returnQuantities.some((rq) => rq.quantity > 0);
  // In annulment mode a reason is required; a plain return leaves notes optional.
  const canSubmitReturn = hasSelectedItems && (!annulMode || returnNotes.trim().length >= 3);

  const handleSubmitReturn = () => {
    if (!selectedSale || !canSubmitReturn) {
      return;
    }

    const itemsToReturn = returnQuantities
      .filter((rq) => rq.quantity > 0)
      .map((rq) => ({
        sale_item_id: rq.saleItemId,
        quantity: rq.quantity,
      }));

    // Annulment stores the reason in the return notes with an explicit
    // line-correction marker so the operation is distinguishable in history.
    const notes = annulMode
      ? `[Аннулирование позиции] ${returnNotes.trim()}`
      : returnNotes || undefined;

    const idempotencyKey = returnKey.take();
    returnMutation.mutate({
      saleId: selectedSale.id,
      payload: {
        items: itemsToReturn,
        refund_method: refundMethod,
        notes,
      },
      idempotencyKey,
      annul: annulMode,
    });
  };

  const creditRemaining = (sale: Sale | null) => Number(sale?.credit_remaining_amount || 0);
  const canAcceptDebtPayment = (sale: Sale | null) =>
    Boolean(
      sale &&
        sale.payment_method === 'credit' &&
        sale.customer_id &&
        sale.status !== 'cancelled' &&
        creditRemaining(sale) > 0,
    );

  const openDebtPaymentModal = (sale: Sale) => {
    setSelectedSale(sale);
    setDebtPaymentAmount(String(Number(sale.credit_remaining_amount || sale.total_amount || 0)));
    setDebtPaymentMethod('cash');
    setDebtPaymentDescription('');
    setShowDebtPaymentModal(true);
  };

  const saveDebtPayment = async () => {
    if (!selectedSale?.customer_id) {
      toast.error('У продажи нет клиента для оплаты долга');
      return;
    }
    // Number('12,5') is NaN, and NaN <= 0 is false — a comma sailed past this
    // guard into a 422 whose detail is an array the toast cannot render.
    const parsedDebtAmount = parseEditableAmount(debtPaymentAmount);
    if (parsedDebtAmount === null || parsedDebtAmount <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }

    setDebtPaymentSubmitting(true);
    try {
      await customersApi.recordPayment(
        selectedSale.customer_id,
        {
          amount: debtPaymentAmount,
          payment_method: debtPaymentMethod,
          description: debtPaymentDescription.trim() || undefined,
        },
        debtPaymentKey.take(),
      );
      toast.success('Оплата долга сохранена');
      debtPaymentKey.reset();
      setShowDebtPaymentModal(false);
      setShowDetail(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customerLedger'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error: any) {
      if (isIdempotencyConflict(error)) {
        debtPaymentKey.reset();
        toast.error('Сумма изменилась после сбоя. Повторите ещё раз.');
        return;
      }
      // FastAPI's 422 detail is an array; handing it to a toast puts objects
      // where React expects children and takes the whole app down.
      toast.error(errorText(error.response?.data?.detail, 'Не удалось сохранить оплату долга'));
    } finally {
      setDebtPaymentSubmitting(false);
    }
  };

  const renderCreditDebtSummary = (sale: Sale, compact = false) => {
    if (sale.payment_method !== 'credit') {
      return null;
    }

    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-900/20 ${compact ? 'text-xs' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">Долг клиента</p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              {sale.customer_name || (sale.customer_id ? `Клиент #${sale.customer_id}` : 'Клиент не указан')}
            </p>
          </div>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {debtStatusText(sale.payment_status)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <p className="text-[var(--erp-warn)]">Сумма</p>
            <p className="font-bold tabular-nums text-amber-900 dark:text-amber-100">{formatCurrency(sale.credit_amount || sale.total_amount)}</p>
          </div>
          <div>
            <p className="text-[var(--erp-warn)]">Оплачено</p>
            <p className="font-bold tabular-nums text-green-700 dark:text-green-300">{formatCurrency(sale.credit_paid_amount || '0')}</p>
          </div>
          <div>
            <p className="text-[var(--erp-warn)]">Осталось по долгу</p>
            <p className="font-bold tabular-nums text-red-700 dark:text-red-300">{formatCurrency(sale.credit_remaining_amount || '0')}</p>
          </div>
        </div>
        {canAcceptDebtPayment(sale) && (
          <button
            type="button"
            onClick={() => openDebtPaymentModal(sale)}
            className="mt-3 w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
          >
            Принять оплату долга
          </button>
        )}
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-50 text-[var(--erp-success)]',
      partially_returned: 'bg-[var(--erp-badge-bg)] text-[var(--erp-badge-text)]',
      returned: 'bg-red-50 text-[var(--erp-accent)]',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return styles[status] || styles.completed;
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = {
      completed: 'Завершён',
      partially_returned: 'Част. возврат',
      returned: 'Возврат',
      cancelled: 'Аннулирован',
    };
    return texts[status] || status;
  };

  const getItemById = (id: number): SaleItem | undefined =>
    selectedSale?.items.find((item) => item.id === id);

  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'completed', label: 'Завершён' },
    { key: 'returns', label: 'Возвраты' },
    { key: 'cancelled', label: 'Аннулирован' },
  ];
  const paymentOptions: Array<{ value: PaymentFilter; label: string }> = [
    { value: 'all', label: 'Все оплаты' },
    { value: 'cash', label: 'Наличные' },
    { value: 'card', label: 'Карта' },
    { value: 'mobile', label: 'Мобильный' },
    { value: 'credit', label: 'В долг' },
  ];
  const activeFilterCount =
    (paymentFilter !== 'all' ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0);
  const resetAdvancedFilters = () => {
    setPaymentFilter('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <>
      <div className="flex h-full min-h-0 gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* Page header */}
          <div className="mb-3 flex flex-none items-end gap-4">
            <div>
              <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">История продаж</h2>
              <p className="mt-0.5 text-[13px] text-gray-500">{totals.count} чеков</p>
            </div>
          </div>

          {/* Header row */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex shrink-0 gap-0.5 overflow-x-auto border border-[var(--erp-divider)] bg-white p-1">
              {statusTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    statusFilter === tab.key
                      ? 'bg-[var(--erp-text)] text-white'
                      : 'text-gray-500 hover:text-[var(--erp-text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <SalesSearch
                value={searchInput}
                onChange={setSearchInput}
                onSelect={setSearchInput}
                suggestions={suggestionsSettled ? searchSuggestions : []}
                isLoading={
                  suggestionsLoading ||
                  (!suggestionsSettled && searchInput.trim().length >= 2)
                }
                isSearching={isFetching && !loading}
              />
              <FilterMenu activeCount={activeFilterCount} onReset={resetAdvancedFilters}>
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                      Способ оплаты
                    </span>
                    <select
                      aria-label="Способ оплаты"
                      value={paymentFilter}
                      onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
                      className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm outline-none focus:border-[var(--erp-text)]"
                    >
                      {paymentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                        Дата от
                      </span>
                      <input
                        type="date"
                        aria-label="Дата от"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                        className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm outline-none focus:border-[var(--erp-text)]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                        Дата до
                      </span>
                      <input
                        type="date"
                        aria-label="Дата до"
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                        className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm outline-none focus:border-[var(--erp-text)]"
                      />
                    </label>
                  </div>

                  <p className="text-xs tabular-nums text-[var(--erp-muted)]">
                    Показано: {visibleSales.length} из {total ?? sales.length}
                  </p>
                </div>
              </FilterMenu>
              <button
                type="button"
                aria-label="Обновить продажи"
                onClick={() => refetch()}
                className="flex h-10 shrink-0 items-center justify-center gap-2 bg-[var(--erp-accent)] px-3 text-sm text-white hover:opacity-90 sm:px-4"
              >
                <ArrowPathIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Обновить</span>
              </button>
            </div>
          </div>

          {/* KPI cards */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="border-2 border-[var(--erp-divider)] bg-white p-4">
              <p className="text-xs text-gray-500">Оборот</p>
              <p className="text-xl font-extrabold tabular-nums text-[var(--erp-text)] sm:text-2xl">{formatCurrency(totals.turnover)}</p>
              {/* The reports page headlines net revenue; showing it here too is
                  what lets an operator reconcile the two screens. */}
              <p className="mt-1 text-[11px] tabular-nums text-[var(--erp-muted)]">
                чистая: {formatCurrency(totals.net)}
              </p>
              {/* Two distinct views of the same day, deliberately not merged:
                  1) turnover split by method (Наличные+Карта+В долг === Оборот) —
                     these are SALES, so none can go negative;
                  2) «В кассе» — the physical drawer, which is cash sales PLUS долг
                     collected in cash. It can legitimately exceed Оборот when old
                     debt is repaid today, which is exactly why the two differ.
                  Folding погашение into a «в долг остаток» made that line go
                  negative on a filtered day and Касса overtake Оборот. */}
              <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 dark:border-gray-700">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 dark:text-gray-400">Наличные</span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-300">{formatCurrency(totals.cash)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 dark:text-gray-400">Карта</span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-300">{formatCurrency(totals.card)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 dark:text-gray-400">В долг</span>
                  <span className="tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(totals.credit)}</span>
                </div>
                {totals.mobile > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400">Онлайн</span>
                    <span className="tabular-nums text-gray-600 dark:text-gray-300">{formatCurrency(totals.mobile)}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-1 text-[11px] dark:border-gray-700">
                  <span className="text-gray-500 dark:text-gray-400">В кассе (наличными)</span>
                  <span className="font-semibold tabular-nums text-[var(--erp-success)]">{formatCurrency(totals.cash + totals.cashDebtPayments)}</span>
                </div>
                {totals.cashDebtPayments > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--erp-muted)]">
                    <span>· в т.ч. оплата долга</span>
                    <span className="tabular-nums">{formatCurrency(totals.cashDebtPayments)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="border-2 border-[var(--erp-divider)] bg-white p-4">
              <p className="text-xs text-gray-500">Чеков</p>
              <p className="text-xl font-extrabold tabular-nums text-[var(--erp-text)] sm:text-2xl">{totals.count}</p>
            </div>
            <div className="border-2 border-[var(--erp-divider)] bg-white p-4">
              <p className="text-xs text-gray-500">Средний чек</p>
              <p className="text-xl font-extrabold tabular-nums text-[var(--erp-text)] sm:text-2xl">{formatCurrency(totals.avg)}</p>
            </div>
            <div className="border-2 border-[var(--erp-divider)] bg-[var(--erp-warn-bg)] p-4">
              <p className="text-xs text-[var(--erp-accent)]">Возвраты</p>
              <p className="text-xl font-extrabold tabular-nums text-[var(--erp-accent)] sm:text-2xl">{formatCurrency(totals.refunds)}</p>
              <p className="text-[11px] tabular-nums text-[var(--erp-accent)]/70">{totals.refundOps} операций</p>
            </div>
          </div>

          {/* Hourly chart */}
          {!loading && totals.turnover > 0 && (
            <div className="mb-3 border-2 border-[var(--erp-divider)] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[var(--erp-text)]">Оборот по часам</p>
                <span className="text-[11px] text-[var(--erp-muted)]">08:00 – 22:00</span>
              </div>
              {/* No items-end here: it stops the columns stretching to h-20, so
                  the flex-1 bar box collapses to 0px and every bar renders as a
                  percentage of nothing. The columns must fill the row; the bar
                  box aligns its own bar to the bottom. */}
              <div className="flex h-20 gap-1">
                {hourly.slice.map((b) => (
                  <div key={b.hour} className="flex flex-1 flex-col items-center gap-1" title={`${b.hour}:00 — ${formatCurrency(b.value)}`}>
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full bg-[var(--erp-accent)]/80 transition-all hover:bg-[var(--erp-accent)]"
                        style={{ height: `${Math.max(b.value > 0 ? 6 : 0, (b.value / hourly.max) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-[var(--erp-muted)]">{b.hour}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={6} columns={6} />
              </div>
            ) : isError ? (
              // A failed query used to render the empty state, so a server
              // outage read as "you sold nothing today".
              <div className="p-4">
                <QueryError what="продажи" onRetry={() => void refetch()} />
              </div>
            ) : visibleSales.length === 0 ? (
              <div className="p-12 text-center text-[var(--erp-muted)]">Продажи не найдены</div>
            ) : (
              <div className="h-full overflow-y-auto">
                {/* Mobile list */}
                <div className="divide-y divide-[var(--erp-divider)] sm:hidden">
                  {visibleSales.map((sale) => {
                    const chip = paymentChip(sale);
                    return (
                      <button
                        key={sale.id}
                        onClick={() => handleViewSale(sale)}
                        className="flex w-full items-center gap-3 p-3 text-left active:bg-[var(--erp-surface)]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-[var(--erp-text)]">#{sale.id}</span>
                            <span className={`px-2 py-0.5 text-[10px] font-medium ${getStatusBadge(sale.status)}`}>
                              {getStatusText(sale.status)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-[var(--erp-muted)]">
                            {sale.cashier_name} · {new Date(sale.created_at).toLocaleString('ru-RU')}
                          </p>
                          <span className={`mt-1 inline-block px-2 py-0.5 text-[10px] ${chip.cls}`}>{chip.label}</span>
                        </div>
                        <div className="text-right">
                          <p className="font-bold tabular-nums text-[var(--erp-text)]">{formatCurrency(sale.total_amount)}</p>
                          {Number(sale.refunded_amount) > 0 && (
                            <p className="text-[11px] tabular-nums text-[var(--erp-warn)]">−{formatCurrency(sale.refunded_amount!)}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <table className="hidden w-full text-sm sm:table">
                  <thead>
                    <tr className="border-b-2 border-[var(--erp-divider)] text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                      <th className="px-4 py-3 text-left font-semibold">Чек</th>
                      <th className="px-4 py-3 text-left font-semibold">Время</th>
                      <th className="px-4 py-3 text-left font-semibold">Кассир</th>
                      <th className="px-4 py-3 text-right font-semibold">Позиций</th>
                      <th className="px-4 py-3 text-left font-semibold">Оплата</th>
                      <th className="px-4 py-3 text-right font-semibold">Сумма</th>
                      <th className="px-4 py-3 text-right font-semibold">Возврат</th>
                      <th className="px-4 py-3 text-left font-semibold">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSales.map((sale) => {
                      const chip = paymentChip(sale);
                      const active = showDetail && selectedSale?.id === sale.id;
                      return (
                        <tr
                          key={sale.id}
                          onClick={() => handleViewSale(sale)}
                          className={`cursor-pointer border-b border-[var(--erp-divider)] transition-colors hover:bg-[var(--erp-surface)] ${
                            active ? 'bg-[var(--erp-surface)]' : ''
                          }`}
                        >
                          {/* The receipt number is the row's keyboard handle —
                              a click-only <tr> made the whole history
                              unreachable on a keyboard- and scanner-driven POS. */}
                          <td className="px-4 py-3 font-mono font-semibold text-[var(--erp-text)]">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleViewSale(sale);
                              }}
                              aria-label={`Открыть чек №${sale.id}`}
                              className="font-mono font-semibold text-[var(--erp-text)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
                            >
                              #{sale.id}
                            </button>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-gray-500">
                            {new Date(sale.created_at).toLocaleString('ru-RU')}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{sale.cashier_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">{sale.items?.length ?? 0}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.label}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--erp-text)]">
                            {formatCurrency(sale.total_amount)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {Number(sale.refunded_amount) > 0 ? (
                              <span className="text-[var(--erp-warn)]">−{formatCurrency(sale.refunded_amount!)}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-[11px] font-medium ${getStatusBadge(sale.status)}`}>
                              {getStatusText(sale.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {hasMore && (
                  <div className="flex justify-center border-t border-[var(--erp-divider)] p-4">
                    <button
                      type="button"
                      onClick={() => loadMore()}
                      disabled={isFetchingNextPage}
                      className="border border-[var(--erp-divider)] px-5 py-2 text-sm font-medium text-gray-600 hover:border-[var(--erp-text)] disabled:opacity-50"
                    >
                      {isFetchingNextPage
                        ? 'Загрузка…'
                        : `Показать ещё${total ? ` · ${sales.length} из ${total}` : ''}`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Slide-over: sale detail (desktop) */}
        {showDetail && selectedSale && (
          <div className="hidden w-[360px] shrink-0 flex-col overflow-hidden border-2 border-[var(--erp-divider)] bg-white lg:flex">
            <div className="flex items-start gap-3 border-b border-[var(--erp-divider)] px-5 py-4">
              <div>
                <h2 className="font-mono text-[17px] font-bold text-[var(--erp-text)]">Чек #{selectedSale.id}</h2>
                <p className="text-[12px] text-[var(--erp-muted)]">
                  {new Date(selectedSale.created_at).toLocaleString('ru-RU')} · {selectedSale.cashier_name}
                </p>
              </div>
              <span className={`ml-auto px-2 py-0.5 text-[11px] font-medium ${getStatusBadge(selectedSale.status)}`}>
                {getStatusText(selectedSale.status)}
              </span>
              <button
                onClick={() => setShowDetail(false)}
                className="p-1 text-[var(--erp-muted)] hover:text-[var(--erp-text)]"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700">
                  <p className="text-[12px] text-gray-500 dark:text-gray-400">Итого</p>
                  <p className="text-[18px] font-semibold tabular-nums text-gray-900 dark:text-white">{formatCurrency(selectedSale.total_amount)}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
                  <p className="text-[12px] text-emerald-600">К возврату</p>
                  <p className="text-[18px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">Товары · {selectedSale.items.length}</p>
                <div className="space-y-2">
                  {selectedSale.items.map((item: any) => {
                    const outstanding = itemOutstanding(item);
                    const fullyAnnulled =
                      item.transaction_type === 'sale' &&
                      Number(item.quantity_returned || 0) >= Number(item.quantity) &&
                      Number(item.quantity) > 0;
                    const canAnnulItem =
                      canManagePos &&
                      item.transaction_type === 'sale' &&
                      outstanding > 0 &&
                      ['completed', 'partially_returned'].includes(selectedSale.status);
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate ${
                              fullyAnnulled ? 'text-[var(--erp-muted)] line-through' : 'text-gray-800 dark:text-gray-100'
                            }`}
                          >
                            {item.product_name}
                          </p>
                          <p className="text-[11px] text-[var(--erp-muted)]">
                            {soldAs(item).quantity} {soldAs(item).unit} × {formatCurrency(item.unit_price)}
                            {item.quantity_returned > 0 && (
                              <span className="ml-1 text-[var(--erp-warn)]">({item.quantity_returned} возв.)</span>
                            )}
                          </p>
                          {fullyAnnulled && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                              Аннулирован
                            </span>
                          )}
                          {canAnnulItem && (
                            <button
                              type="button"
                              onClick={() => void handleOpenAnnulItem(selectedSale, item)}
                              className="mt-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                            >
                              Аннулировать позицию
                            </button>
                          )}
                        </div>
                        <span className="shrink-0 font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700">
                <div className="flex justify-between text-[13px] text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(selectedSale.subtotal)}</span></div>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(selectedSale.tax_amount)}</span></div>
                <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-[13px] font-semibold text-gray-900 dark:border-gray-700 dark:text-white"><span>Итого</span><span className="tabular-nums">{formatCurrency(selectedSale.total_amount)}</span></div>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Оплата</span><span>{paymentChip(selectedSale).label}</span></div>
              </div>

              {renderCreditDebtSummary(selectedSale)}

              <div>
                <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">История возвратов</p>
                {returnsLoading ? (
                  <p className="py-3 text-center text-[13px] text-[var(--erp-muted)]">Загрузка…</p>
                ) : returns.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-[var(--erp-muted)]">
                    {returnsFailed
                      ? 'История возвратов не загрузилась — проверьте связь.'
                      : 'Возвратов нет'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {returns.map((ret) => (
                      <div key={ret.id} className="rounded-xl bg-[var(--erp-warn-bg)] p-3 dark:bg-orange-900/20">
                        <div className="flex justify-between">
                          <span className="text-[12px] font-medium text-gray-900 dark:text-white">Возврат #{ret.id}</span>
                          <span className="text-[12px] font-bold tabular-nums text-[var(--erp-warn)]">−{formatCurrency(ret.total_refund_amount)}</span>
                        </div>
                        <p className="text-[11px] text-gray-500">
                          {ret.user_name} · {new Date(ret.created_at).toLocaleString('ru-RU')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--erp-divider)] p-4">
              {/* A customer coming back for a duplicate had no path: the receipt
                  renderer only ever ran once, straight after checkout. */}
              <button
                type="button"
                onClick={() => printReceipt(selectedSale)}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 border border-[var(--erp-divider)] px-3 text-sm font-semibold text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
              >
                <PrinterIcon className="h-4 w-4" />
                Печать чека
              </button>
              {canManagePos && (selectedSale as any).can_return && (
                <button
                  onClick={() => {
                    setShowDetail(false);
                    handleOpenReturnModal(selectedSale);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg min-h-11 bg-[var(--erp-accent)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)]"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" />
                  Оформить возврат
                </button>
              )}
              {canManagePos && ['completed', 'partially_returned'].includes(selectedSale.status) && (
                <button
                  onClick={() => void openVoidDialog(selectedSale)}
                  className="flex flex-1 items-center justify-center rounded-lg border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Аннулировать
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal — mobile only */}
      {showDetail && selectedSale && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm lg:hidden">
          <div
            ref={mobileDetailRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-detail-title"
            className="max-h-[90dvh] w-full overflow-hidden border-t-2 border-[var(--erp-divider)] bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--erp-divider)] px-4 py-3">
              <div>
                <h2 id="mobile-detail-title" className="font-mono text-base font-bold text-[var(--erp-text)]">Чек #{selectedSale.id}</h2>
                <p className="text-[10px] text-[var(--erp-muted)]">{new Date(selectedSale.created_at).toLocaleString('ru-RU')}</p>
              </div>
              <button onClick={() => setShowDetail(false)} className="p-1 text-[var(--erp-muted)] hover:text-[var(--erp-text)]">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700"><p className="text-[10px] text-gray-500">Итого</p><p className="font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(selectedSale.total_amount)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20"><p className="text-[10px] text-emerald-600">К возврату</p><p className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}</p></div>
              </div>
              {renderCreditDebtSummary(selectedSale, true)}
              <div className="space-y-2">
                {selectedSale.items.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 p-2 text-xs dark:bg-gray-700">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900 dark:text-white">{item.product_name}</p>
                      <p className="text-[10px] text-[var(--erp-muted)]">{soldAs(item).quantity} {soldAs(item).unit} × {formatCurrency(item.unit_price)}</p>
                    </div>
                    <span className="font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.total)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--erp-divider)] p-4">
              <button
                type="button"
                onClick={() => printReceipt(selectedSale)}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 border border-[var(--erp-divider)] px-3 text-sm font-semibold text-[var(--erp-text)] hover:border-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
              >
                <PrinterIcon className="h-4 w-4" /> Печать
              </button>
              {canManagePos && (selectedSale as any).can_return && (
                <button
                  onClick={() => { setShowDetail(false); handleOpenReturnModal(selectedSale); }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg min-h-11 bg-[var(--erp-accent)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)]"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" /> Возврат
                </button>
              )}
              {canManagePos && ['completed', 'partially_returned'].includes(selectedSale.status) && (
                <button onClick={() => void openVoidDialog(selectedSale)} className="rounded-lg border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
                  Аннулировать
                </button>
              )}
              <button onClick={() => setShowDetail(false)} className="rounded-lg px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            ref={returnPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-modal-title"
            className="max-h-[90dvh] w-full overflow-hidden border-2 border-[var(--erp-divider)] bg-white shadow-2xl sm:max-w-2xl"
          >
            <div className="border-b-2 border-[var(--erp-divider)] bg-[var(--erp-surface)] px-4 py-3 sm:px-6 sm:py-4">
              <h2 id="return-modal-title" className="text-base font-bold text-[var(--erp-text)] sm:text-xl">
                {annulMode ? 'Аннулировать позицию' : `Возврат #${selectedSale.id}`}
              </h2>
              <p className="text-xs text-[var(--erp-muted)] sm:text-sm">
                {annulMode
                  ? `Продажа #${selectedSale.id} · позиция будет возвращена полностью`
                  : `Доступно: ${formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}`}
              </p>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4 sm:p-6">
              <div className="mb-4 space-y-2 sm:mb-6 sm:space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:text-base">
                  {annulMode ? 'Позиция для аннулирования' : 'Товары для возврата'}
                </h3>
                {returnQuantities.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Нет товаров для возврата</p>
                ) : (
                  returnQuantities.map((rq) => {
                    const item = getItemById(rq.saleItemId);
                    if (!item) {
                      return null;
                    }

                    return (
                      <div
                        key={rq.saleItemId}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-700/50 sm:p-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200 sm:text-base">
                            {item.product_name}
                          </p>
                          <p className="text-[10px] text-[var(--erp-muted)] sm:text-sm">
                            Доступно: {toSoldUnits(rq.maxQuantity, item)} {soldAs(item).unit}
                          </p>
                        </div>
                        {annulMode ? (
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                            {toSoldUnits(rq.quantity, item)} {soldAs(item).unit}
                          </span>
                        ) : (
                          <div className="flex flex-shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuantityChange(
                                  rq.saleItemId,
                                  toBaseUnits(toSoldUnits(rq.quantity, item) - 1, item),
                                )
                              }
                              aria-label="Уменьшить количество"
                              className="flex h-11 w-11 items-center justify-center border border-[var(--erp-divider)] text-sm font-bold text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] disabled:opacity-40"
                              disabled={rq.quantity <= 0}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={toSoldUnits(rq.maxQuantity, item)}
                              value={toSoldUnits(rq.quantity, item)}
                              step="any"
                              inputMode="decimal"
                              aria-label={`Количество к возврату: ${item.product_name}`}
                              // parseInt floored 1.5 kg to 1 while the field
                              // still showed 1.5 — a refund the cashier read
                              // and would not get.
                              onChange={(e) =>
                                handleQuantityChange(
                                  rq.saleItemId,
                                  toBaseUnits(parseFloat(e.target.value) || 0, item),
                                )
                              }
                              className="min-h-11 w-16 border border-[var(--erp-divider)] bg-white text-center text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] sm:w-20"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleQuantityChange(
                                  rq.saleItemId,
                                  toBaseUnits(toSoldUnits(rq.quantity, item) + 1, item),
                                )
                              }
                              aria-label="Увеличить количество"
                              className="flex h-11 w-11 items-center justify-center border border-[var(--erp-divider)] text-sm font-bold text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] disabled:opacity-40"
                              disabled={rq.quantity >= rq.maxQuantity}
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mb-3 sm:mb-4">
                <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300 sm:text-sm">
                  Способ возврата
                </label>
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 sm:px-4 sm:py-2.5 sm:text-base"
                >
                  {refundMethods.map((method) => (
                    <option key={method} value={method}>
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300 sm:text-sm">
                  {annulMode ? 'Причина аннулирования' : 'Примечание'}
                </label>
                <textarea
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder={annulMode ? 'Например: ошибочно пробитая позиция' : 'Причина возврата...'}
                  rows={2}
                  maxLength={500}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 sm:px-4 sm:py-2.5 sm:text-base"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:gap-3 sm:px-6 sm:py-4">
              <button
                onClick={() => setShowReturnModal(false)}
                className="order-2 rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 sm:order-1 sm:text-base"
                disabled={returnMutation.isPending}
              >
                Отмена
              </button>
              <button
                onClick={handleSubmitReturn}
                disabled={returnMutation.isPending || !canSubmitReturn}
                className="order-1 rounded-xl bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-red-600 disabled:opacity-50 sm:order-2 sm:px-6 sm:text-base"
              >
                {returnMutation.isPending
                  ? 'Обработка...'
                  : annulMode
                    ? 'Подтвердить аннулирование'
                    : 'Подтвердить возврат'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDebtPaymentModal && selectedSale && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            ref={debtPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="debt-payment-title"
            className="w-full border-2 border-[var(--erp-divider)] bg-white p-4 shadow-2xl sm:max-w-md"
          >
            <h2 id="debt-payment-title" className="text-lg font-black text-[var(--erp-text)]">Оплата долга</h2>
            <p className="mt-1 text-sm text-gray-500">
              Чек #{selectedSale.id}
              {selectedSale.customer_name ? ` · ${selectedSale.customer_name}` : ''}
            </p>
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              Осталось по долгу: <span className="font-black tabular-nums">{formatCurrency(selectedSale.credit_remaining_amount || '0')}</span>
            </div>

            <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Сумма оплаты
              <input
                type="text"
                inputMode="decimal"
                value={debtPaymentAmount}
                onChange={(event) => setDebtPaymentAmount(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-right text-lg font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Способ оплаты долга
              <select
                value={debtPaymentMethod}
                onChange={(event) => setDebtPaymentMethod(event.target.value as 'cash' | 'card' | 'mobile')}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="mobile">Мобильный</option>
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Примечание
              <input
                type="text"
                value={debtPaymentDescription}
                onChange={(event) => setDebtPaymentDescription(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDebtPaymentModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={debtPaymentSubmitting}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={saveDebtPayment}
                disabled={debtPaymentSubmitting}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-gray-400"
              >
                Сохранить оплату
              </button>
            </div>
          </div>
        </div>
      )}

      <AnnulmentDialog
        open={showVoidDialog}
        title={`Аннулировать продажу #${selectedSale?.id ?? ''}`}
        preview={voidPreview}
        loading={voidLoading}
        submitting={voidSubmitting}
        onClose={() => setShowVoidDialog(false)}
        onConfirm={(reason) => void confirmVoid(reason)}
      />
    </>
  );
}

export default function SalesPage() {
  return (
    <ModuleGuard module="sales">
      <SalesHistory />
    </ModuleGuard>
  );
}
