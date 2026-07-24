# ERP UI Redesign (Phase 3 visual) Implementation Plan

> **For agentic workers:** Execute stage by stage; the visual source of truth is
> `docs/superpowers/specs/2026-07-24-erp-ui-redesign/sellary-erp-design.html`
> (approved Claude Design prototype). Layouts must match it; data plumbing and
> secondary details (tables, forms) reuse the existing pages.

**Goal:** Odoo-style modular workspace UI: apps launcher, icon rail, per-module
secondary sidebar, POS as a chrome-less fullscreen workspace — wired to the
already-shipped module-permission system (`useModules`, `canAccessModule`).

**User decision (2026-07-24):** layouts exactly per the prototype; the rest
(tables, small conveniences) at implementer's discretion, blended to the same
visual language.

## Design language (from the prototype)

- Sharp corners everywhere (no border-radius), 1–2px solid borders.
- CSS vars: `--color-bg` (near-white), `--color-surface` (light gray),
  `--color-divider` (#e4e0da-ish), `--color-text` (near-black),
  `--color-accent` (orange-red ~#E2452F), success green `#157347`,
  warning brown `#a75a12` on beige `#fdf6e6`/`#f6ead9`.
- Headings: extrabold (font-extrabold tracking-tight), big page titles (30px).
- Manager-only pages show a lock icon in the secondary sidebar; manager badge
  chips use beige bg `#f6ead9` / text `#8a4a0d`.
- Tabular numbers for money (`tabular-nums`).

## Shell anatomy (desktop)

1. **Header 56px** (hidden on POS): Sellary wordmark → `/apps`; "Приложения"
   button (grid icon); breadcrumb `▪ Module / Page`; right: company chip,
   avatar (accent square, initial) + name/role.
2. **Icon rail 74px** (hidden on POS): one icon+label button per GRANTED
   module, tooltip on hover, active = accent left edge/filled state.
3. **Secondary sidebar 216px** (hidden on POS and on `/apps`): module title +
   uppercase tagline, page list (active = filled), lock icon on manager-only
   pages the user lacks, footer "Уровень доступа: Сотрудник/Менеджер/
   Администратор".
4. **Content**: existing pages rendered inside.
5. **/apps launcher**: "Рабочее пространство · {company}" kicker, H1
   "Приложения", 3-col grid of granted module cards (icon box 46px, level
   badge, 20px extrabold label, muted tagline). Root `/` and post-login
   redirect land here.
6. **POS**: own 52px header (Касса + tab-like links to /sales /shifts
   /customers + shift status dot + user + "Приложения" button), no rail/header.
7. **Нет доступа page**: centered lock box, module name in «», "К приложениям"
   button (per prototype).

## Module registry (single source: `src/lib/moduleNav.ts`)

| Module | Rail label | Pages (label → href) |
|---|---|---|
| pos | Касса | Касса → /pos (fullscreen); История продаж → /sales; Смена → /shifts; Клиенты → /customers |
| inventory | Склад | Товары → /products; Инвентаризация → /products?tab=inventory (manager) |
| purchasing | Закупки | Поставщики → /suppliers; Заказы поставщикам → /purchase-orders |
| shop | Магазин | Заказы → /orders |
| reports | Отчеты | Дашборд → /dashboard; Аналитика → /reports |
| (admin) | Настройки | Компания/Маркетплейс/Сотрудники → /settings (admin-only rail item) |

Levels come from `useModules()`; admin = everything + Настройки.

## Stages

**Stage A — shell (DONE first):** tokens in `globals.css`; `moduleNav.ts`;
new `Layout.tsx` (header+rail+secondary); `/apps` launcher page; root redirect
to /apps; POS chrome; ModuleGuard restyle. Existing pages untouched inside.
**Stage B — page restyle:** page headers (30px title + muted subtitle + primary
action right), tables to the bordered sharp style, badges/buttons unified.
**Stage C — mobile:** module-first bottom bar (≤4 granted modules + Ещё),
per-prototype mobile POS.
**Stage D (later, code Phase 3):** `src/modules/<module>/` restructure +
duplicate-layer cleanup (`src/api.ts`, `src/store/`, `App.tsx.bak`).

Verification per stage: `npx vitest run` green, `npm run build` clean, browser
smoke (admin all-modules; single-module employee).
