import type { OrderStatus } from '../types';

/** Russian labels shown to the shopper for each order lifecycle status. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  preparing: 'Готовится',
  ready: 'Готов',
  delivering: 'Доставляется',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

/** Tailwind badge classes (bg + text) per status. */
export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  preparing: 'bg-indigo-100 text-indigo-800',
  ready: 'bg-purple-100 text-purple-800',
  delivering: 'bg-cyan-100 text-cyan-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

export function statusBadge(status: string): string {
  return ORDER_STATUS_BADGE[status as OrderStatus] ?? 'bg-gray-100 text-gray-800';
}
