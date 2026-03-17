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
      <title>Receipt #${sale.id}</title>
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
      <h1>RETAIL POS</h1>
      <div class="subtitle">Point of Sale Receipt</div>
      <div class="divider"></div>
      <table>
        <tr>
          <td><strong>Receipt #</strong></td>
          <td style="text-align: right;">${sale.id}</td>
        </tr>
        <tr>
          <td><strong>Date</strong></td>
          <td style="text-align: right;">${new Date(sale.created_at).toLocaleString()}</td>
        </tr>
        <tr>
          <td><strong>Cashier</strong></td>
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
          <td>Subtotal:</td>
          <td>${formatCurrency(sale.subtotal)}</td>
        </tr>
        <tr>
          <td>Tax:</td>
          <td>${formatCurrency(sale.tax_amount)}</td>
        </tr>
        <tr>
          <td>Discount:</td>
          <td>-${formatCurrency(sale.discount_amount)}</td>
        </tr>
        <tr style="font-size: 14px;">
          <td><strong>TOTAL:</strong></td>
          <td><strong>${formatCurrency(sale.total_amount)}</strong></td>
        </tr>
        <tr>
          <td>Payment:</td>
          <td>${sale.payment_method.toUpperCase()}</td>
        </tr>
      </table>
      <div class="footer">
        <p>Thank you for your purchase!</p>
        <p>Please come again</p>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(document);
  printWindow.document.close();
  printWindow.print();
};

function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}
