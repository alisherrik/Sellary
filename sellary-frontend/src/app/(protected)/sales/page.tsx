'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { salesApi, metaApi, customersApi, generateIdempotencyKey } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { TableSkeleton } from '@/components/skeletons';
import FilterMenu from '@/components/filters/FilterMenu';
import AnnulmentDialog from '@/components/transactions/AnnulmentDialog';
import { Sale, SaleItem, VoidPreview } from '@/lib/types';
import { useAuthStore } from '@/lib/store';
import { useDebounce } from '@/hooks/useDebounce';
import { useSaleSearchSuggestions, useInfiniteSales, useSalesSummary } from '@/hooks/useQueries';
import SalesSearch from '@/components/sales/SalesSearch';

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
      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    };
  }
  if (sale.payment_method === 'card') {
    return {
      label: `💳 ${sale.card_type ? cardLabels[sale.card_type] ?? sale.card_type : 'Карта'}`,
      cls: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300',
    };
  }
  if (sale.payment_method === 'mobile') {
    return { label: '📱 Мобильный', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300' };
  }
  return { label: '💵 Наличные', cls: 'bg-zinc-100 text-zinc-600 dark:bg-gray-700 dark:text-gray-300' };
};

const debtStatusText = (status?: Sale['payment_status']) => {
  const labels: Record<string, string> = {
    unpaid: 'Не оплачено',
    partial: 'Частично оплачено',
    paid: 'Оплачено',
    settled: 'Оплачено',
  };
  return labels[status || 'paid'] || status || 'Оплачено';
};

export default function SalesHistory() {
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
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const debouncedSearch = useDebounce(searchInput, 300);

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
      toast.error(error.response?.data?.detail || 'Не удалось проверить аннулирование');
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
      toast.error(error.response?.data?.detail?.message || error.response?.data?.detail || 'Аннулирование не выполнено');
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
      setShowReturnModal(false);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowDetail(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Ошибка при оформлении возврата');
    },
  });

  const handleViewSale = async (sale: Sale) => {
    setSelectedSale(sale);
    setShowDetail(true);
    setReturnsLoading(true);
    try {
      const res = await salesApi.getReturns(sale.id);
      setReturns(res.data);
    } catch {
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

    const idempotencyKey = generateIdempotencyKey();
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
    if (!debtPaymentAmount.trim() || Number(debtPaymentAmount) <= 0) {
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
        generateIdempotencyKey(),
      );
      toast.success('Оплата долга сохранена');
      setShowDebtPaymentModal(false);
      setShowDetail(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customerLedger'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось сохранить оплату долга');
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
            <p className="text-amber-700/70 dark:text-amber-300/70">Сумма</p>
            <p className="font-bold tabular-nums text-amber-900 dark:text-amber-100">{formatCurrency(sale.credit_amount || sale.total_amount)}</p>
          </div>
          <div>
            <p className="text-amber-700/70 dark:text-amber-300/70">Оплачено</p>
            <p className="font-bold tabular-nums text-green-700 dark:text-green-300">{formatCurrency(sale.credit_paid_amount || '0')}</p>
          </div>
          <div>
            <p className="text-amber-700/70 dark:text-amber-300/70">Осталось по долгу</p>
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
      completed: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
      partially_returned: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300',
      returned: 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-300',
      cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
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
      <div className="flex h-full min-h-0 gap-4">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* Header row */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex shrink-0 gap-0.5 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
              {statusTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    statusFilter === tab.key
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
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
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Способ оплаты
                    </span>
                    <select
                      aria-label="Способ оплаты"
                      value={paymentFilter}
                      onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
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
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Дата от
                      </span>
                      <input
                        type="date"
                        aria-label="Дата от"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Дата до
                      </span>
                      <input
                        type="date"
                        aria-label="Дата до"
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                      />
                    </label>
                  </div>

                  <p className="text-xs tabular-nums text-gray-400">
                    Показано: {visibleSales.length} из {total ?? sales.length}
                  </p>
                </div>
              </FilterMenu>
              <button
                type="button"
                aria-label="Обновить продажи"
                onClick={() => refetch()}
                className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 sm:px-4"
              >
                <ArrowPathIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Обновить</span>
              </button>
            </div>
          </div>

          {/* KPI cards */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">Оборот</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(totals.turnover)}</p>
              {/* The reports page headlines net revenue; showing it here too is
                  what lets an operator reconcile the two screens. */}
              <p className="mt-1 text-[11px] tabular-nums text-gray-400">
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
                  <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">{formatCurrency(totals.cash + totals.cashDebtPayments)}</span>
                </div>
                {totals.cashDebtPayments > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>· в т.ч. оплата долга</span>
                    <span className="tabular-nums">{formatCurrency(totals.cashDebtPayments)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">Чеков</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{totals.count}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">Средний чек</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(totals.avg)}</p>
            </div>
            <div className="rounded-2xl bg-red-50 p-4 dark:bg-red-900/20">
              <p className="text-xs text-red-500">Возвраты</p>
              <p className="text-xl font-bold tabular-nums text-red-600 sm:text-2xl">{formatCurrency(totals.refunds)}</p>
              <p className="text-[11px] tabular-nums text-red-400">{totals.refundOps} операций</p>
            </div>
          </div>

          {/* Hourly chart */}
          {!loading && totals.turnover > 0 && (
            <div className="mb-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Оборот по часам</p>
                <span className="text-[11px] text-gray-400">08:00 – 22:00</span>
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
                        className="w-full rounded-t bg-blue-500/80 transition-all hover:bg-blue-600"
                        style={{ height: `${Math.max(b.value > 0 ? 6 : 0, (b.value / hourly.max) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-gray-400">{b.hour}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={6} columns={6} />
              </div>
            ) : visibleSales.length === 0 ? (
              <div className="p-12 text-center text-gray-500">Продажи не найдены</div>
            ) : (
              <div className="h-full overflow-y-auto">
                {/* Mobile list */}
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50 sm:hidden">
                  {visibleSales.map((sale) => {
                    const chip = paymentChip(sale);
                    return (
                      <button
                        key={sale.id}
                        onClick={() => handleViewSale(sale)}
                        className="flex w-full items-center gap-3 p-3 text-left active:bg-gray-50 dark:active:bg-gray-700/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">#{sale.id}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusBadge(sale.status)}`}>
                              {getStatusText(sale.status)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-400">
                            {sale.cashier_name} · {new Date(sale.created_at).toLocaleString('ru-RU')}
                          </p>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${chip.cls}`}>{chip.label}</span>
                        </div>
                        <div className="text-right">
                          <p className="font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(sale.total_amount)}</p>
                          {Number(sale.refunded_amount) > 0 && (
                            <p className="text-[11px] tabular-nums text-orange-600">−{formatCurrency(sale.refunded_amount!)}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <table className="hidden w-full text-sm sm:table">
                  <thead>
                    <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-400 dark:border-gray-700">
                      <th className="px-4 py-3 text-left font-medium">Чек</th>
                      <th className="px-4 py-3 text-left font-medium">Время</th>
                      <th className="px-4 py-3 text-left font-medium">Кассир</th>
                      <th className="px-4 py-3 text-right font-medium">Позиций</th>
                      <th className="px-4 py-3 text-left font-medium">Оплата</th>
                      <th className="px-4 py-3 text-right font-medium">Сумма</th>
                      <th className="px-4 py-3 text-right font-medium">Возврат</th>
                      <th className="px-4 py-3 text-left font-medium">Статус</th>
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
                          className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-gray-700/40 ${
                            active ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <td className="px-4 py-3 font-mono font-semibold text-gray-900 dark:text-white">#{sale.id}</td>
                          <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-gray-400">
                            {new Date(sale.created_at).toLocaleString('ru-RU')}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{sale.cashier_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">{sale.items?.length ?? 0}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.label}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                            {formatCurrency(sale.total_amount)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {Number(sale.refunded_amount) > 0 ? (
                              <span className="text-orange-600">−{formatCurrency(sale.refunded_amount!)}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusBadge(sale.status)}`}>
                              {getStatusText(sale.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {hasMore && (
                  <div className="flex justify-center border-t border-gray-50 p-4 dark:border-gray-700/50">
                    <button
                      type="button"
                      onClick={() => loadMore()}
                      disabled={isFetchingNextPage}
                      className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
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
          <div className="hidden w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:flex">
            <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div>
                <h2 className="font-mono text-[17px] font-bold text-gray-900 dark:text-white">Чек #{selectedSale.id}</h2>
                <p className="text-[12px] text-gray-400">
                  {new Date(selectedSale.created_at).toLocaleString('ru-RU')} · {selectedSale.cashier_name}
                </p>
              </div>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusBadge(selectedSale.status)}`}>
                {getStatusText(selectedSale.status)}
              </span>
              <button
                onClick={() => setShowDetail(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
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
                      isAdmin &&
                      item.transaction_type === 'sale' &&
                      outstanding > 0 &&
                      ['completed', 'partially_returned'].includes(selectedSale.status);
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate ${
                              fullyAnnulled ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-100'
                            }`}
                          >
                            {item.product_name}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {item.quantity} {item.uom} × {formatCurrency(item.unit_price)}
                            {item.quantity_returned > 0 && (
                              <span className="ml-1 text-orange-600">({item.quantity_returned} возв.)</span>
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
                  <p className="py-3 text-center text-[13px] text-gray-400">Загрузка…</p>
                ) : returns.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-gray-400">Возвратов нет</p>
                ) : (
                  <div className="space-y-2">
                    {returns.map((ret) => (
                      <div key={ret.id} className="rounded-xl bg-orange-50 p-3 dark:bg-orange-900/20">
                        <div className="flex justify-between">
                          <span className="text-[12px] font-medium text-gray-900 dark:text-white">Возврат #{ret.id}</span>
                          <span className="text-[12px] font-bold tabular-nums text-orange-600">−{formatCurrency(ret.total_refund_amount)}</span>
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

            <div className="mt-auto flex gap-2 border-t border-gray-100 p-4 dark:border-gray-700">
              {(selectedSale as any).can_return && (
                <button
                  onClick={() => {
                    setShowDetail(false);
                    handleOpenReturnModal(selectedSale);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" />
                  Оформить возврат
                </button>
              )}
              {isAdmin && ['completed', 'partially_returned'].includes(selectedSale.status) && (
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
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div>
                <h2 className="font-mono text-base font-bold text-gray-900 dark:text-white">Чек #{selectedSale.id}</h2>
                <p className="text-[10px] text-gray-400">{new Date(selectedSale.created_at).toLocaleString('ru-RU')}</p>
              </div>
              <button onClick={() => setShowDetail(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
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
                      <p className="text-[10px] text-gray-500">{item.quantity} {item.uom} × {formatCurrency(item.unit_price)}</p>
                    </div>
                    <span className="font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.total)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 border-t border-gray-100 p-4 dark:border-gray-700">
              {(selectedSale as any).can_return && (
                <button
                  onClick={() => { setShowDetail(false); handleOpenReturnModal(selectedSale); }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" /> Возврат
                </button>
              )}
              {isAdmin && ['completed', 'partially_returned'].includes(selectedSale.status) && (
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
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:max-w-2xl sm:rounded-2xl">
            <div className="border-b border-slate-200 bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 dark:border-slate-700 sm:px-6 sm:py-4">
              <h2 className="text-base font-bold text-white sm:text-xl">
                {annulMode ? 'Аннулировать позицию' : `Возврат #${selectedSale.id}`}
              </h2>
              <p className="text-[10px] text-white/80 sm:text-sm">
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
                          <p className="text-[10px] text-slate-500 sm:text-sm">Доступно: {rq.maxQuantity}</p>
                        </div>
                        {annulMode ? (
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                            {rq.quantity} шт.
                          </span>
                        ) : (
                          <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity - 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-sm font-bold hover:bg-slate-300 dark:bg-slate-600 sm:h-8 sm:w-8"
                              disabled={rq.quantity <= 0}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={rq.maxQuantity}
                              value={rq.quantity}
                              onChange={(e) => handleQuantityChange(rq.saleItemId, parseInt(e.target.value) || 0)}
                              className="w-10 rounded-lg border border-slate-300 bg-white py-1 text-center text-sm dark:border-slate-600 dark:bg-slate-700 sm:w-16"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity + 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-sm font-bold hover:bg-slate-300 dark:bg-slate-600 sm:h-8 sm:w-8"
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
                className="order-1 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-red-600 disabled:opacity-50 sm:order-2 sm:px-6 sm:text-base"
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
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-black text-gray-900 dark:text-white">Оплата долга</h2>
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
