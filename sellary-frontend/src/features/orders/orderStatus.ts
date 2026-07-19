import type { FulfillmentType, OrderStatus, OrderStatusAdvanceTarget } from '@/lib/types';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  preparing: 'Готовится',
  ready: 'Готов',
  delivering: 'В доставке',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-700',
  preparing: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-teal-100 text-teal-700',
  delivering: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-600',
};

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  delivery: 'Доставка',
  pickup: 'Самовывоз',
};

interface StatusAction {
  target: OrderStatusAdvanceTarget;
  label: string;
}

export function nextStatusActions(
  status: OrderStatus,
  fulfillment: FulfillmentType,
): StatusAction[] {
  switch (status) {
    case 'confirmed':
      return [{ target: 'preparing', label: 'В работу' }];
    case 'preparing':
      return [{ target: 'ready', label: 'Готов' }];
    case 'ready':
      return fulfillment === 'delivery'
        ? [{ target: 'delivering', label: 'Передать в доставку' }]
        : [{ target: 'completed', label: 'Выдан клиенту' }];
    case 'delivering':
      return [{ target: 'completed', label: 'Доставлен' }];
    default:
      return [];
  }
}

export function canConfirm(status: OrderStatus): boolean {
  return status === 'pending';
}

export function canCancel(status: OrderStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}
