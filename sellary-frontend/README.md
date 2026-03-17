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
# Edit .env if backend is not at http://localhost:8000
```

3. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Build

```bash
npm run build
```

## Features

- **POS Terminal**: Fast product scanning, cart management, payment processing
- **Dashboard**: Real-time sales overview, low stock alerts, top products
- **Products**: Full CRUD with search, filtering, and stock management
- **Reports**: Sales trends, profit analysis, top selling products
- **Hotkeys**: F2 (focus barcode), Enter (complete sale), Esc (clear cart)

## Keyboard Shortcuts

- `F2` - Focus barcode input
- `Enter` - Complete sale
- `Esc` - Clear cart / Cancel
- `Ctrl+P` - Print receipt
- `+/-` - Adjust quantity
