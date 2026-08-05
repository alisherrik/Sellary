// Keyed on what the server writes into inventory_logs.reference_type. Anything
// missing here reads as a bare «Изменение», which tells the shop nothing.
export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  sale: 'Продажа',
  sale_return: 'Возврат',
  sale_void: 'Аннулирование продажи',
  sale_cancel: 'Отмена продажи',
  po_receive: 'Приёмка',
  po_void: 'Аннулирование закупки',
  po_item_void: 'Аннулирование позиции закупки',
  manual_adjust: 'Корректировка',
  stocktake: 'Инвентаризация',
  surplus: 'Излишек',
  shortage: 'Недостача',
  other: 'Прочее',
  write_off: 'Списание',
  product_initial: 'Начальный остаток',
  product_delete: 'Удаление товара',
  product_recreate: 'Пересоздание товара',
  ledger_repair: 'Ремонт реестра',
};
