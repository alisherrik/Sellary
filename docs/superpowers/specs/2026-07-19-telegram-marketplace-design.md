# Telegram Mini App Marketplace — Design

**Date:** 2026-07-19
**Status:** Approved design (roadmap spec; each phase gets its own plan → implementation)

## Overview

Add an online storefront to Sellary as a **Telegram Mini App marketplace**. Multiple shops
(companies) list their products in one shared marketplace; shoppers browse across shops,
filter by shop/category, add to a single cart, and place orders. Each shop fulfills and gets
paid for its own portion. A later website reuses the same public API.

This document is the overarching roadmap. It is decomposed into 6 phases (F1–F6); each phase
is implemented through its own spec → plan → code cycle.

## Goals (MVP scope)

**In MVP:**
- Catalog with search + category filter + shop filter
- Cart + checkout, split per shop (multi-vendor cart → one order per shop)
- Order status tracking for the shopper (confirmed / preparing / ready / delivering / completed)
- Merchant product management: `is_published` toggle + product image
- Simple shop storefront/branding (logo, name, description)

**Out of MVP (later):**
- Discounts / promo codes
- Reviews / ratings
- Online payment (Payme/Click) — MVP is cash on delivery/pickup
- Wishlist / favorites

## Key Decisions

1. **Single shared bot** (`@SellaryShopBot`), not a bot per shop. Shops are separated by
   `company_id`, consistent with the existing multi-tenant architecture. A per-shop bot may be
   added later as a Pro option, but is not built now.
2. **Marketplace model** (not per-shop storefront isolation): multiple shops' products appear
   together; shopper filters by shop/category. Each product card shows which shop it belongs to.
3. **No login — Telegram identity only.** The Mini App receives `initData` automatically; the
   server verifies its HMAC-SHA256 hash with the bot token. Shopper identity = verified
   `telegram_id`. A per-shop `Customer` row is created/linked on purchase so each shop owns its
   customer records (for future chat, discounts, loyalty).
4. **Phone captured on first order** via Telegram's one-tap contact share. Not required to browse.
5. **Fulfillment: delivery + pickup**, each shop configures which it supports.
6. **Payment: cash on delivery/pickup only** for MVP. No online payment integration.
7. **Stock committed at confirmation, not at order time.** An `Order` is a request that does not
   touch stock. When the merchant confirms, a `Sale` is created through the existing
   `sale_service`, and the FIFO ledger decrements stock. Oversell is naturally prevented — if
   stock is insufficient, the ledger errors and the order stays `pending` for the merchant to
   resolve. Catalog shows a low-stock hint but does not hard-reserve.
8. **Product images: single primary `image_url`** (gallery deferred), stored on **Cloudinary**
   (free tier) for CDN delivery + automatic resize/compression — important for mobile users on
   slow connections. Railway's default container disk is ephemeral; Cloudinary avoids that.
9. **Which products appear online:** opt-in per product via `is_published` (default off).
10. **Online price = `sell_price`** (no separate online price in MVP).
11. **Merchant manages orders in the existing Next.js frontend** at `/orders`.
12. **New-order notification via the Telegram bot** to the shop owner (real-time push).

## Architecture

**Approach A — Telegram Mini App as a 4th monorepo package.**

- `sellary-shop/` — new Vite + React + TS package (same pattern as `sellary-cashier`), the
  Telegram Mini App shopper frontend.
- `sellary-backend/` — extended with a public marketplace API (`/api/shop/*`), a new Order
  domain (model/service/repository), Cloudinary upload, and a Telegram bot webhook.
- `sellary-frontend/` — existing Next.js admin gets a new `/orders` page for merchants.

The backend stays single (one DB, one FIFO ledger) so stock and `Sale` remain centralized and
shared with the POS. Only the presentation layer is new.

## Data Model

### Changes to existing tables (migrations)

`products`:
- `image_url` (String, nullable) — Cloudinary URL
- `is_published` (Boolean, default `False`) — show in marketplace

`companies`:
- `is_marketplace_enabled` (Boolean, default `False`)
- `logo_url` (String, nullable)
- `marketplace_description` (String, nullable)
- `supports_delivery` (Boolean, default `True`)
- `supports_pickup` (Boolean, default `True`)

`customers`:
- `telegram_id` (String/BigInt, nullable) with a partial-unique index per
  `(company_id, telegram_id)` where `telegram_id IS NOT NULL` — mirrors the existing
  `client_customer_id` pattern. Links a per-shop `Customer` to a global Telegram shopper.

### New tables

`telegram_users` — global shopper identity (no login):
- `id`, `telegram_id` (unique), `first_name`, `username`, `phone` (nullable — shared on first
  order), `created_at`

`orders` — an order request, separate from `Sale`:
- `id`, `order_number` (sequential per company), `company_id`, `telegram_user_id`,
  `customer_id` (nullable — linked on confirm)
- `status` enum: `pending → confirmed → preparing → ready → delivering → completed`, plus
  `cancelled`
- `fulfillment_type` enum: `delivery` | `pickup`
- `delivery_address` (nullable), `contact_phone`, `contact_name`
- `subtotal`, `total_amount`, `notes`
- `sale_id` (nullable FK to `sales`) — set on confirm; stock decrements at that point
- `checkout_group_id` (uuid, nullable) — groups the N orders split from one cart
- `created_at`, `updated_at`

`order_items` — order lines with price/name snapshot:
- `id`, `order_id`, `product_id`, `product_name` (snapshot), `unit_price` (snapshot),
  `quantity`, `line_total`

`merchant_notify_links` — Telegram chats to notify per shop:
- `id`, `company_id`, `telegram_chat_id`, `created_at`

### Cart

The cart is **not** persisted server-side. It lives in the Mini App (localStorage). At
checkout the cart is split by `company_id` into N `orders` sharing a `checkout_group_id`.

## API Surface

### A) Public marketplace API — `/api/shop/*` (Telegram initData auth)

Every request carries `X-Telegram-Init-Data`; the server verifies the HMAC-SHA256 hash with
`BOT_TOKEN` and rejects stale/forged data. Verified `telegram_id` maps to a `telegram_users` row.

| Endpoint | Purpose |
|---|---|
| `GET /api/shop/catalog` | Marketplace products across shops. Filters: `search`, `category`, `company`; paginated. Only `is_published=true` products of `is_marketplace_enabled=true` shops |
| `GET /api/shop/products/{id}` | Single product detail |
| `GET /api/shop/shops` | Shop list (for filter) with logo/name |
| `GET /api/shop/shops/{slug}` | Single shop storefront + its products |
| `GET /api/shop/categories` | Categories (for filter) |
| `POST /api/shop/orders` | Place order (**Idempotency-Key** required). Cart split by `company_id` → N orders. Phone may be shared here |
| `GET /api/shop/orders` | "My orders" — all orders for this `telegram_id` |
| `GET /api/shop/orders/{id}` | Order status |
| `POST /api/shop/me/phone` | Share phone (first order or profile) |

### B) Merchant API — `/api/*` (company-scoped access_token)

| Endpoint | Purpose |
|---|---|
| `GET /api/orders` | Incoming orders (filter by status) |
| `GET /api/orders/{id}` | Order detail |
| `POST /api/orders/{id}/confirm` | Confirm (**Idempotency-Key**) → creates `Sale`, decrements stock, sets `sale_id` |
| `POST /api/orders/{id}/status` | Advance status: `preparing`/`ready`/`delivering`/`completed` |
| `POST /api/orders/{id}/cancel` | Reject (with reason); if a `Sale` exists, runs the existing cancel/reversal flow |
| `PATCH /api/products/{id}` (extend) | Add `is_published`, `image_url` |
| `POST /api/products/{id}/image` | Upload image to Cloudinary |
| `PATCH /api/company/marketplace` | Storefront settings (logo, description, delivery/pickup) |

### C) Telegram bot webhook — `/api/telegram/webhook`

- Merchant links their chat to a company via `/start` → `merchant_notify_links`
- New order → push notification to the shop owner
- (Later) order status change → notify the shopper

Both `POST /api/shop/orders` and `POST /api/orders/{id}/confirm` require an `Idempotency-Key`
(existing pattern; safe under retries/double-taps).

## Order Lifecycle

```
Shopper places order
        │
        ▼
   [pending] ──────────► [cancelled]   (merchant rejects / shopper cancels)
        │  merchant "Confirm"
        │  → Sale created, stock decremented, sale_id set
        ▼
  [confirmed] → [preparing] → [ready] ──┬── delivery ──► [delivering] ──► [completed]
                                        └── pickup ────────────────────► [completed]
```

- **pending → confirmed** is the critical transition: `sale_service.create_sale()` runs, the
  FIFO ledger decrements stock. If stock is insufficient, the order stays `pending` and the
  merchant resolves it.
- Cancelling after confirm runs the existing cancel/reversal flow to restore stock.
- `pickup` orders skip `delivering`.

## Telegram Auth Flow

```
Mini App opens → Telegram provides initData (id, name, username, hash)
Every API call: header X-Telegram-Init-Data: <initData>
Server verifies hash via HMAC-SHA256 with BOT_TOKEN (rejects forged/stale)
telegram_id → get-or-create telegram_users row → request runs as that shopper
```

## Merchant Notification Flow

Link once: shop owner opens the bot → `/start` (deep-link from the Mini App carries company
context) → bot stores `(company_id, chat_id)` in `merchant_notify_links`.

On new order: `order_service` finds the company's notify links and sends a Telegram message
("🛒 New order #123, 3 items, 150 000, delivery, [View] → /orders").

## Phases (build order)

| Phase | Scope | Outcome |
|---|---|---|
| **F1 — Foundation (data + images)** | Migrations (products, companies, telegram_users, customers.telegram_id). Cloudinary upload. Merchant `is_published`/image management in `/products` | Shop prepares products for online |
| **F2 — Public catalog API** | `/api/shop/catalog`, `/products`, `/shops`, `/categories` + initData auth | Catalog readable |
| **F3 — Mini App storefront** | `sellary-shop/` package. Catalog, search, filters (shop/category), product detail, cart (localStorage) | Shopper browses + adds to cart |
| **F4 — Order domain + checkout** | `orders`/`order_items` model/service/repo. `POST /api/shop/orders` (split + idempotency). "My orders". Phone share | Shopper places order |
| **F5 — Merchant order management** | Next.js `/orders` page. confirm (→Sale) / status / cancel. Ledger wiring | Merchant confirms + sells |
| **F6 — Telegram bot notifications** | Bot webhook, merchant link (`/start`), new-order push | Merchant notified in real time |

Each phase builds on the previous. F1–F2 are backend-heavy; F3 is the first visible result;
F4–F5 carry the core business value; F6 completes the experience.

## Testing

- **Backend (`pytest`):** order lifecycle, split-checkout, idempotency replay, confirm→Sale→stock
  decrement, oversell handling, initData hash verification (unit + integration). Transaction-
  rollback isolation (`session.flush()`, not commit).
- **Mini App (`vitest`):** cart logic, checkout split, components (same as cashier).
- **Frontend (`vitest`):** `/orders` page, confirm/status flow.
- **CI:** `python -m compileall` gate + all package tests; add `sellary-shop` to
  `.github/workflows/ci.yml`.

## Security

- **initData verification is mandatory** on every public request (HMAC-SHA256; reject expired
  `auth_date`). Without it, anyone could act as any `telegram_id`.
- **Multi-tenant isolation:** public catalog shows only `is_published` products of
  `is_marketplace_enabled` shops; orders always written under their `company_id`; merchant API
  uses existing company-token isolation.
- **Idempotency** on order placement and confirm.
- **Image upload:** merchant token only; file type/size limits; Cloudinary validates/optimizes.
- **Price snapshot** in `order_items` so later price changes don't alter existing orders.

## Open Items for Later (explicitly deferred)

- Online payment (Payme/Click) and multi-vendor split settlement
- Delivery logistics (courier, zones, delivery-fee calculation)
- Reviews/ratings, discounts/promo codes, wishlist
- Per-shop custom bot (Pro option)
- Product image gallery (multiple images)
- Shopper-facing status-change notifications
