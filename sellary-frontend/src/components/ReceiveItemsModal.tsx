import { useState } from 'react';
import { PurchaseOrder, PurchaseOrderItem } from '@/lib/types';
import { purchaseOrdersApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface ReceiveItemsModalProps {
  purchaseOrder: PurchaseOrder;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReceiveItemsModal({ purchaseOrder, onClose, onSuccess }: ReceiveItemsModalProps) {
  const [receivingItems, setReceivingItems] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    purchaseOrder.items.forEach((item) => {
      initial[item.id] = 0;
    });
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);

  const maxReceivable = (item: PurchaseOrderItem) => {
    return item.quantity_ordered - item.quantity_received;
  };

  const canReceive = (item: PurchaseOrderItem, qty: number) => {
    return qty > 0 && qty <= maxReceivable(item);
  };

  const hasAnyReceivable = () => {
    return Object.values(receivingItems).some((qty, index) => {
      const item = purchaseOrder.items[index];
      return qty > 0 && canReceive(item, qty);
    });
  };

  const handleSubmit = async () => {
    if (!hasAnyReceivable()) {
      toast.error('Введите количество');
      return;
    }

    setSubmitting(true);
    try {
      const items = purchaseOrder.items
        .map((item) => ({
          item_id: item.id,
          quantity_to_receive: receivingItems[item.id] || 0,
        }))
        .filter((item) => item.quantity_to_receive > 0);

      await purchaseOrdersApi.receive(purchaseOrder.id, { items });
      toast.success('Товары получены');
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveAll = () => {
    const newReceivingItems: Record<number, number> = {};
    purchaseOrder.items.forEach((item) => {
      newReceivingItems[item.id] = maxReceivable(item);
    });
    setReceivingItems(newReceivingItems);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div>
            <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
              Получение - #{purchaseOrder.id}
            </h3>
            <p className="text-[10px] sm:text-sm text-gray-500">{purchaseOrder.supplier?.name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Items List */}
        <div className="p-3 sm:p-6 overflow-y-auto max-h-[60vh] space-y-2 sm:space-y-3">
          {purchaseOrder.items.map((item) => {
            const max = maxReceivable(item);
            const qty = receivingItems[item.id] || 0;
            const isValid = canReceive(item, qty);

            return (
              <div key={item.id} className="border dark:border-gray-700 rounded-xl p-2 sm:p-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                      {item.product?.name || 'Товар'}
                    </p>
                  </div>
                  {max === 0 && (
                    <span className="text-green-600 text-[10px] sm:text-xs flex items-center">
                      <CheckIcon className="w-3 h-3 sm:w-4 sm:h-4 mr-0.5" />
                      Получено
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-sm mb-2">
                  <div>
                    <span className="text-gray-500">Заказ:</span>
                    <span className="ml-1 font-medium">{item.quantity_ordered}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Получено:</span>
                    <span className="ml-1 font-medium">{item.quantity_received}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Осталось:</span>
                    <span className="ml-1 font-medium text-green-600">{max}</span>
                  </div>
                </div>

                {max > 0 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max={max}
                      value={qty}
                      onChange={(e) =>
                        setReceivingItems({
                          ...receivingItems,
                          [item.id]: parseFloat(e.target.value) || 0,
                        })
                      }
                      className={`w-20 h-8 sm:h-9 px-2 text-center rounded-lg border text-sm ${!isValid && qty > 0 ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-700`}
                    />
                    <button
                      onClick={() => setReceivingItems({ ...receivingItems, [item.id]: max })}
                      className="text-[10px] sm:text-xs text-blue-600 hover:underline"
                    >
                      Всё ({max})
                    </button>
                    {!isValid && qty > 0 && (
                      <span className="text-red-500 text-[10px] sm:text-xs">Макс: {max}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 safe-area-bottom">
          <button
            type="button"
            onClick={handleReceiveAll}
            className="text-blue-600 hover:underline text-xs sm:text-sm font-medium order-2 sm:order-1"
          >
            Получить всё
          </button>

          <div className="flex gap-2 order-1 sm:order-2">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
              disabled={submitting || !hasAnyReceivable()}
            >
              {submitting ? 'Получение...' : 'Получить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
