import { useSettingsStore, CURRENCIES } from '@/store/settingsStore';

export const formatCurrency = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const currencyCode = useSettingsStore.getState().currency;
  const currency = CURRENCIES[currencyCode];

  try {
    return new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  } catch (e) {
    // Fallback if locale is not supported
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency.code,
    }).format(num);
  }
};

export const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
};

export const formatDateTime = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('ru-RU').format(num);
};

export const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return (value / total) * 100;
};

export const printReceipt = (sale: any): void => {
  const printWindow = window.open('', '', 'width=400,height=600');
  if (!printWindow) return;

  const itemsHtml = sale.items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 4px 0;">${item.product_name} x${item.quantity}</td>
      <td style="text-align: right; padding: 4px 0;">${formatCurrency(item.total)}</td>
    </tr>
  `
    )
    .join('');

  const document = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Чек #${sale.id}</title>
      <style>
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          width: 280px;
          margin: 0 auto;
          padding: 20px;
        }
        h1 {
          text-align: center;
          font-size: 18px;
          margin-bottom: 5px;
        }
        .subtitle {
          text-align: center;
          font-size: 10px;
          margin-bottom: 20px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        .divider {
          border-top: 1px dashed #000;
          margin: 10px 0;
        }
        .totals {
          margin-top: 10px;
        }
        .totals tr td:last-child {
          text-align: right;
          font-weight: bold;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <h1>SELLARY</h1>
      <div class="subtitle">Товарный чек</div>
      <div class="divider"></div>
      <table>
        <tr>
          <td><strong>Чек №</strong></td>
          <td style="text-align: right;">${sale.id}</td>
        </tr>
        <tr>
          <td><strong>Дата</strong></td>
          <td style="text-align: right;">${new Date(sale.created_at).toLocaleString('ru-RU')}</td>
        </tr>
        <tr>
          <td><strong>Кассир</strong></td>
          <td style="text-align: right;">${sale.cashier_name}</td>
        </tr>
      </table>
      <div class="divider"></div>
      <table>
        ${itemsHtml}
      </table>
      <div class="divider"></div>
      <table class="totals">
        <tr>
          <td>Подытог:</td>
          <td>${formatCurrency(sale.subtotal)}</td>
        </tr>
        <tr>
          <td>Налог:</td>
          <td>${formatCurrency(sale.tax_amount)}</td>
        </tr>
        <tr>
          <td>Скидка:</td>
          <td>-${formatCurrency(sale.discount_amount)}</td>
        </tr>
        <tr style="font-size: 14px;">
          <td><strong>ИТОГО:</strong></td>
          <td><strong>${formatCurrency(sale.total_amount)}</strong></td>
        </tr>
        <tr>
          <td>Оплата:</td>
          <td>${sale.payment_method.toUpperCase() === 'CASH' ? 'НАЛИЧНЫЕ' : 'КАРТА'}</td>
        </tr>
      </table>
      <div class="footer">
        <p>Спасибо за покупку!</p>
        <p>Приходите еще</p>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(document);
  printWindow.document.close();
  printWindow.print();
};

type KeyHandler = (e: KeyboardEvent) => void;

interface HotkeyConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: KeyHandler;
  description: string;
}

class HotkeyManager {
  private hotkeys: HotkeyConfig[] = [];

  register(config: HotkeyConfig) {
    this.hotkeys.push(config);
  }

  unregister(key: string) {
    this.hotkeys = this.hotkeys.filter((h) => h.key === key);
  }

  handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true'
    ) {
      if (e.key !== 'F2') {
        return;
      }
    }

    for (const hotkey of this.hotkeys) {
      const keyMatch = e.key.toLowerCase() === hotkey.key.toLowerCase() ||
        e.code === hotkey.key;
      const ctrlMatch = hotkey.ctrl === undefined || e.ctrlKey === hotkey.ctrl;
      const shiftMatch = hotkey.shift === undefined || e.shiftKey === hotkey.shift;
      const altMatch = hotkey.alt === undefined || e.altKey === hotkey.alt;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        hotkey.handler(e);
        return;
      }
    }
  }

  getHotkeysList(): HotkeyConfig[] {
    return [...this.hotkeys];
  }
}

export const hotkeyManager = new HotkeyManager();

export const registerHotkeys = () => {
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => hotkeyManager.handleKeyDown(e));
  }
};

export default hotkeyManager;
