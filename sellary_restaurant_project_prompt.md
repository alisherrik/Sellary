# Sellary Restaurant / Choyxona Project – Full Specification Prompt

## Overview
This document describes a **complete, production-ready restaurant/choyxona system** built on top of the existing **Sellary POS backend**, without breaking or modifying the current **Retail/Magazine UI**.

The goal is to:
- Keep **one backend (Sellary Core)**
- Preserve the **existing retail POS UI** as-is
- Add a **new Restaurant UI** with mobile-first UX
- Do **minimal, safe backend refactoring** only where necessary
- Focus heavily on **real user experience for waiters and cashiers**

This document is intended to be given **as-is** to a large AI agent or development team.

---

## Core Principles

- **Backend is the single source of truth**
- **Frontend contains ZERO business logic**
- **Retail flow must not be broken**
- **Restaurant flow is an extension, not a rewrite**
- **Mobile-first UX is mandatory**
- **Correctness and usability > complexity**

---

## Current System State (Do Not Break)

- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Existing UI: Next.js 14 Retail / Magazine POS
- Features already implemented:
  - Sales
  - Sale items
  - Inventory management
  - Purchase orders
  - Returns
  - Reports
  - Payments (cash / card / mobile)

⚠️ The existing retail UI MUST continue to work without any changes.

---

## Part 1: Backend Strategy (Minimal Refactor)

### 1. Shared Backend Core

The backend becomes a **shared engine** for multiple business types:

- Retail (magazine)
- Restaurant / Choyxona

No duplicate logic. No parallel backends.

---

### 2. Sale Context Type

Add a new field to the `sales` table:

```text
sales.context_type = "retail" | "restaurant"
```

Rules:
- Default value: `retail`
- Existing retail flows remain unchanged
- Restaurant UI always creates sales with `context_type = restaurant`

---

### 3. Product Type Extension

Extend the `products` table with:

```text
products.product_type = "item" | "dish"
```

Usage:
- `item` → retail products (barcode-based)
- `dish` → restaurant menu items (no barcode)

Inventory rules remain the same:
- Dishes may reduce stock or not (configurable)
- Raw materials can still be tracked via inventory

---

### 4. Optional Lightweight Fields (Only If Needed)

These fields may be added if required by UX:

- `sale.note` (kitchen or waiter notes)
- `sale.table_name` (e.g. "Table 3", "VIP")

❌ Do NOT add complex restaurant-only schemas unless absolutely necessary.

---

## Part 2: Restaurant Business Flow

### Concept Mapping

| Restaurant Concept | Existing Sellary Concept |
|-------------------|--------------------------|
| Order             | Sale                     |
| Ordered dish      | Sale item                |
| Close order       | Complete sale            |
| Cancel order      | Cancel sale              |
| Return            | Sale return              |

---

### Restaurant Order Flow

1. Staff selects a table
2. System creates an OPEN sale (`context_type = restaurant`)
3. Staff adds dishes to the order
4. Order remains editable
5. Customer finishes eating
6. Payment is taken
7. Sale is marked COMPLETED
8. Inventory, logs, and reports update automatically

Notes:
- No barcode scanning
- No instant checkout
- Orders stay open until payment

---

## Part 3: Restaurant UI – General Requirements

### UX Priorities

- Mobile-first (phones & tablets)
- Touch-friendly controls
- Large buttons and readable text
- Minimal typing
- Fast, instant feedback
- Designed for waiters, not accountants

### Supported Devices

- Android phones
- Tablets
- Small screens
- Slow or unstable internet connections

---

## Part 4: Restaurant UI Screens

### 1. Table Selection Screen (Home)

Features:
- Grid of tables (Table 1, Table 2, VIP, Outside, etc.)
- Visual status indicators:
  - Empty
  - Active (order open)

UX rules:
- One-tap access
- No forms
- Large touch targets

---

### 2. Order Screen (Main Working Screen)

Components:
- Selected table name (top)
- Dish categories (horizontal scroll)
- Dish list as cards with + / − buttons
- Sticky bottom order summary

Actions:
- Add dish
- Increase/decrease quantity
- Remove dish
- Add note to dish or order

UX rules:
- No page reloads
- Instant updates
- Bottom sheet instead of modal where possible

---

### 3. Payment Screen

Features:
- Order total amount
- Payment method selection:
  - Cash
  - Card
  - Mobile
- Confirm payment action

Rules:
- Uses existing payment logic
- No new backend payment rules

---

### 4. Order History (Minimal)

Features:
- List of completed orders
- Filter by date
- Read-only view

---

## Part 5: Frontend Architecture Rules

- Frontend must NEVER implement business rules
- Backend determines:
  - What can be edited
  - What can be paid
  - What can be cancelled
- Frontend only renders backend flags

---

## Part 6: Performance & Mobile UX

### Performance

- Instant navigation
- Skeleton loaders instead of spinners
- Prefetch data where possible
- Avoid blocking renders

### Mobile UX Rules

- Button height ≥ 44px
- No hover-only interactions
- Bottom navigation preferred
- One-handed usage friendly

---

## Part 7: Frontend Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Zustand (UI state only)
- Axios (API calls)
- React Query (caching & prefetch)

Navigation:
- Use `next/link`
- Enable route prefetching
- Prefetch menu data on app load

---

## Part 8: Success Criteria

The final system must:

- Keep retail POS fully functional
- Provide a complete restaurant workflow
- Feel natural for waiters
- Work smoothly on mobile devices
- Require minimal staff training
- Be safe for real production use

---

## Priority Order

1. User Experience (mobile-first)
2. Correctness
3. Performance
4. Clean architecture
5. Extensibility

---

## Final Note

Do NOT overengineer.

Start simple.

Build for real restaurant usage, not theoretical perfection.

