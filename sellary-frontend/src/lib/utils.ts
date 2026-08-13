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

/**
 * Format money for a column that is meant to be added up by eye.
 *
 * formatCurrency drops trailing zeros, so a till breakdown renders as
 * `TJS 374.3` above `TJS 7` — two numbers whose decimal points do not line up
 * and which read as "374 and a bit" and "seven". On a shift reconciliation the
 * cashier is checking arithmetic, so every amount keeps both digits.
 */
export const formatMoney = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const currencyCode = useSettingsStore.getState().currency;
  const currency = CURRENCIES[currencyCode];

  try {
    return new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch (e) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }
};

/**
 * Format a per-unit price, which carries up to 4 decimals.
 *
 * formatCurrency caps at 2 — correct for money totals, but it would render a
 * 1.8750 catalogue price as 1.88 and make the extra precision look lost.
 */
export const formatUnitPrice = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const currencyCode = useSettingsStore.getState().currency;
  const currency = CURRENCIES[currencyCode];

  try {
    return new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }).format(num);
  } catch (e) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency.code,
      maximumFractionDigits: 4,
    }).format(num);
  }
};

/**
 * Render a stored decimal for a number input: drop trailing zeros so a
 * numeric(10,4) column's "20.0000" edits as "20", while "1.8750" keeps its
 * meaningful digits as "1.875".
 */
export const toPriceInput = (amount: number | string | null | undefined): string => {
  if (amount === null || amount === undefined || amount === '') return '';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return Number.isFinite(num) ? String(num) : '';
};

export const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
};

/**
 * A calendar day off the wire — `2026-08-13` or `2026-08-13T00:00:00+05:00` —
 * as дд.мм.гггг, the shape the server writes its own Russian messages in.
 * Sliced rather than parsed: `new Date('2026-08-13')` is UTC midnight and reads
 * as the 12th anywhere west of Greenwich, which is the wrong day to tell a shop
 * their period was closed on.
 */
export const formatIsoDate = (value: string): string => {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
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

  const paymentLabels: Record<string, string> = {
    cash: 'Наличные',
    card: 'Карта',
    mobile: 'Мобильный',
    credit: 'В долг',
  };
  const cardLabels: Record<string, string> = {
    alif: 'Alif', eskhata: 'Эсхата', dc: 'DC',
  };
  const tenderLabel = (method: string, cardType?: string | null) =>
    method === 'card' && cardType
      ? `${paymentLabels.card} (${cardLabels[cardType] ?? cardType})`
      : paymentLabels[method] ?? method;

  // A split sale is named tender by tender, with the amounts. The receipt is
  // the copy the customer keeps: printing «Наличные» on a sale settled 26
  // наличными, 10 DC, 10 Эсхата and 4 в долг misstates what they handed over
  // and what they still owe.
  const tenders: Array<{ method: string; card_type?: string | null; amount: string }> =
    sale.is_split && Array.isArray(sale.payments) ? sale.payments : [];
  const paymentLabel = tenders.length
    ? tenders
        .map((t) => `${tenderLabel(t.method, t.card_type)} — ${formatCurrency(t.amount)}`)
        .join('<br>')
    : tenderLabel(sale.payment_method, sale.card_type);

  const itemsHtml = sale.items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 4px 0;">${item.product_name} x${item.sold_quantity ?? item.quantity} ${item.sold_unit_label ?? item.uom ?? ''}</td>
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
          <td>${paymentLabel}</td>
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
  // window.print() blocks the thread until the print dialog is dismissed. Run it
  // after the receipt content has rendered and on the next tick so the caller
  // (checkout) can finish clearing the cart and closing its modal first — the
  // register feels instant instead of frozen behind the print dialog.
  printWindow.focus();
  const triggerPrint = () => {
    try {
      printWindow.print();
    } catch {
      /* user closed the window before printing */
    }
  };
  if (printWindow.document.readyState === 'complete') {
    setTimeout(triggerPrint, 0);
  } else {
    printWindow.onload = triggerPrint;
  }
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
    // Replace any existing handler for the same key so repeated registration
    // (e.g. an effect re-running on every dependency change) cannot accumulate
    // duplicate handlers that all fire on a single keypress.
    this.hotkeys = this.hotkeys.filter((h) => h.key !== config.key);
    this.hotkeys.push(config);
  }

  unregister(key: string) {
    this.hotkeys = this.hotkeys.filter((h) => h.key !== key);
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

let keydownListenerAttached = false;

export const registerHotkeys = () => {
  // Attach exactly one global keydown listener for the lifetime of the page.
  // Previously this created a new anonymous listener on every call (and on every
  // navigation to a page that registers hotkeys), so listeners piled up and could
  // never be removed — degrading keyboard responsiveness across the whole app.
  if (typeof document !== 'undefined' && !keydownListenerAttached) {
    document.addEventListener('keydown', (e) => hotkeyManager.handleKeyDown(e));
    keydownListenerAttached = true;
  }
};

export default hotkeyManager;
