# Sellary Frontend

Next.js frontend for the Sellary platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Set NEXT_PUBLIC_API_PROXY_TARGET if your backend is not at http://127.0.0.1:8000
```

3. Start development server:
```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000)

## Build

```bash
npm run build
```

## Features

- **POS Terminal**: Fast product scanning, cart management, payment processing
- **Dashboard**: Real-time sales overview, low stock alerts, top products
- **Products**: Full CRUD with search, filtering, and stock management
- **Reports**: Core MVP reporting for sales, top products, and low stock
- **Hotkeys**: F2 (focus barcode), Enter (complete sale), Esc (clear cart)

## Keyboard Shortcuts

- `F2` - Focus barcode input
- `Enter` - Complete sale
- `Esc` - Clear cart / Cancel
- `Ctrl+P` - Print receipt
- `+/-` - Adjust quantity

## Receipt printing

Receipt printing is **off by default** and controlled in **Settings → «Печать чека»**.
When the toggle is off, completing a sale prints nothing (no receipt, no
"Save as PDF" dialog). When on, the sale calls `window.print()`.

A web page cannot pick a specific printer or print silently on its own — that is
an OS-level capability. To make receipts print straight to a thermal printer
with **no dialog and no PDF**, do this one-time setup on the cashier's machine:

1. Set the receipt/thermal printer as the **default printer** in Windows.
2. Launch Chrome with the `--kiosk-printing` flag, e.g. a desktop shortcut:
   ```
   chrome.exe --kiosk-printing --app=https://<your-pos-url>
   ```

With `--kiosk-printing`, `window.print()` sends the job directly to the default
printer without showing the print dialog.
