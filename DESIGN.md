---
name: Sellary
description: Retail POS, inventory, and supplier management. Calm surfaces, unmistakable money.
colors:
  register-blue: "#2563eb"
  register-blue-hover: "#1d4ed8"
  register-blue-tint: "#eff6ff"
  register-blue-tint-strong: "#dbeafe"
  confirm-green: "#16a34a"
  confirm-green-hover: "#15803d"
  confirm-green-tint: "#f0fdf4"
  confirm-green-tint-strong: "#dcfce7"
  danger-red: "#dc2626"
  danger-red-quiet: "#ef4444"
  danger-red-tint: "#fef2f2"
  ink: "#111827"
  ink-soft: "#374151"
  muted: "#4b5563"
  hairline: "#e5e7eb"
  hairline-soft: "#f3f4f6"
  surface: "#ffffff"
  app-bg: "#f9fafb"
  surface-dark: "#1f2937"
  app-bg-dark: "#111827"
  hairline-dark: "#374151"
  ink-dark: "#f3f4f6"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 900
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  control: "6px"
  card: "8px"
  panel: "12px"
  surface: "16px"
  sheet: "24px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.register-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.register-blue-hover}"
    textColor: "{colors.surface}"
  button-success:
    backgroundColor: "{colors.confirm-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.surface}"
    padding: "12px 32px"
  button-success-hover:
    backgroundColor: "{colors.confirm-green-hover}"
    textColor: "{colors.surface}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 24px"
  product-tile:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "8px 16px"
---

# Design System: Sellary

## 1. Overview

**Creative North Star: "The Quiet Counter"**

Sellary is a working surface, not a showpiece. The system answers to the cashier
who stands at it for eight hours: the screen recedes, the body stays calm and
neutral, and the only things that ever raise their voice are the running total
and the next action. Speed comes from stillness. When nothing decorative
competes for attention, the eye lands on the number and the button without
searching.

Two tiers live under one roof. The **back office** (products, suppliers,
purchase orders, reports, settings) is flat, dense, and businesslike: white
cards on a soft gray field, hairline borders, tables that hold a lot of rows
without shouting. The **register** (POS) is the same palette pulled into a more
tactile, tap-ready language: larger radii, layered shadow on the live action
zone, money set in heavy weight. The palette, the type family, and the accent
logic are identical across both; only the density and the depth change.

This system explicitly rejects the look it shipped from: the generic
default-Tailwind starter (stock `blue-600` on `gray-50` with drop-shadow cards
and gray-on-gray tables) and the dated enterprise-POS register (tiny dense
buttons, cluttered toolbars, text you cannot read across a counter). Restraint
is the brand; color and motion earn their place by meaning something.

**Key Characteristics:**
- One neutral field, one action color (Register Blue), one confirmation color (Confirm Green). Nothing else competes.
- Money is the loudest thing on screen, always: heavy weight, Register Blue, large.
- Flat by default; depth appears only at the register's action zone and in modals.
- One type family (Inter) doing everything through weight, not through extra faces.
- Touch-first targets at the register; denser, keyboard-friendly tables in the back office.
- Light and dark themes are first-class; both meet the same contrast bar.

## 2. Colors

A near-monochrome neutral system with exactly two working accents: one for
action, one for confirmation. Everything else is gray doing structural work.

### Primary
- **Register Blue** (`#2563eb`): the single action and money color. It marks every primary button, the current selection, the focus ring, the running total, and the report line. If a number is actionable or a control is the main thing to press, it is this blue. **Hover** deepens to `#1d4ed8`.
- **Register Blue Tints** (`#eff6ff` background, `#dbeafe` strong, text `#1d4ed8`): the selected/active state for product tiles, category chips, and filter pills. The tint says "this one"; never use it as decoration.

### Secondary
- **Confirm Green** (`#16a34a`): reserved for completion and payment. The "Complete sale" button, the cash-confirmed state, a successfully-weighed item. Green means *done / paid*, not "good in general". **Hover** deepens to `#15803d`; tints `#f0fdf4` / `#dcfce7` carry the confirmed-item state.

### Tertiary
- **Danger Red** (`#dc2626`, quiet variant `#ef4444`): destructive and removal only. Cancel a sale, remove a line item, delete. Tint `#fef2f2` backs the quiet "remove" affordance (red text on a soft red wash). Never use red for emphasis or accent.

### Neutral
- **Ink** (`#111827`): primary text. The default for any reading.
- **Ink Soft** (`#374151`): secondary text, outline-button labels, dark hairlines.
- **Muted** (`#4b5563`): the *floor* for muted text on white. Labels and captions live here, never lighter.
- **Hairline** (`#e5e7eb`) / **Hairline Soft** (`#f3f4f6`): borders, dividers, table rules, table-header fills.
- **Surface** (`#ffffff`): cards, panels, inputs, the register canvas.
- **App Background** (`#f9fafb`): the soft gray field everything sits on.
- **Dark theme**: app background `#111827`, surface `#1f2937`, hairline `#374151`, text `#f3f4f6`.

### Named Rules
**The Two-Accent Rule.** Only two accent colors exist: Register Blue for action,
Confirm Green for completion. Red is a warning, not an accent. Any screen that
introduces a third decorative hue is off-system.

**The Muted Floor Rule.** Muted text never goes lighter than Muted (`#4b5563`)
on white. `gray-400` and lighter are forbidden for any text a user must read;
they fail AA contrast under store lighting. When elegance tempts you lighter,
go the other way and bump toward Ink.

**The Money-Is-Blue Rule.** Currency totals are always Register Blue and always
the heaviest weight in their context. The total is the one thing the cashier
must find without looking.

## 3. Typography

**Display / Body / Label Font:** Inter (with `system-ui, sans-serif` fallback), loaded via `next/font/google`.

**Character:** One humanist sans carries the entire product, from a five-digit
money total down to a table-header label. Hierarchy is built from weight and
size, never from a second typeface. Inter's tabular figures keep columns of
prices aligned; its high legibility holds up at a glance and across a counter.

### Hierarchy
- **Display** (900 "black", 1.875–3rem / `text-3xl`–`text-5xl`, line-height ~1.05): money totals only. The payment-due amount and the cart total. Nothing else uses black weight.
- **Headline** (700 bold, 1.5rem / `text-2xl`, line-height ~1.2): page titles and modal titles ("Оплата").
- **Title** (600 semibold, 1.125rem / `text-lg`): section headers, card headers, sub-totals.
- **Body** (400–500, 0.875–1rem / `text-sm`–`text-base`, line-height 1.5): the default. Prose caps at 65–75ch; table cells and dense UI may run tighter.
- **Label** (500 medium, 0.75rem / `text-xs`, letter-spacing 0.05em, UPPERCASE): table column headers and small status chips only. Uppercase is permitted *here and only here*.

### Named Rules
**The One-Family Rule.** Inter does everything. No display face, no second sans,
no serif. If a screen seems to need another typeface, it needs better weight
contrast instead.

**The Caps-Are-Labels Rule.** All-caps is reserved for `text-xs` table headers
and status chips. All-caps body copy is forbidden; it is unreadable at size.

## 4. Elevation

Flat by default, lift on focus. Back-office surfaces (cards, tables, settings
panels) sit flat on the gray field with a hairline border and at most a `shadow`
hint. Depth is not decoration: it is a signal that a surface is *live or
floating*. It appears in exactly two places, the register's action zone (the
cart panel and the "Complete sale" button) and any modal or bottom sheet.

### Shadow Vocabulary
- **Resting hint** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` / `shadow-sm`): buttons and chips at rest. Barely there.
- **Card** (`box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` / `shadow`): standard back-office cards.
- **Action zone** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` / `shadow-lg`–`shadow-xl`): the register cart panel and primary register buttons, so the live work floats above the catalog.
- **Overlay** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25)` / `shadow-2xl`): modals and payment sheets, paired with a `bg-gray-900/60 backdrop-blur-sm` scrim.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Reach for a heavier
shadow only at the register action zone or for a true overlay. A shadow on a
back-office card heavier than `shadow` is wrong.

## 5. Components

Calm and tap-ready: quiet at rest, generous to the finger, unmistakable on press. Same vocabulary in POS and back office; only size and radius scale up at the register.

### Buttons
- **Shape:** `6px` (`control`) in the back office; `12–16px` (`panel`/`surface`) for register buttons. Pill (`9999px`) for chips only.
- **Primary:** Register Blue (`#2563eb`) fill, white text, `shadow-sm`. Back office padding `8px 16px`; register `12px 24px`+. Hover deepens to `#1d4ed8`; the transition is `colors`, ~150ms.
- **Success:** Confirm Green (`#16a34a`) fill, white text, used only for "Complete sale" / payment. Disabled collapses to `gray-300` fill, `not-allowed` cursor.
- **Danger / Remove:** Red text on a `#fef2f2` wash for quiet removals; solid `#dc2626` only for hard destructive confirmation.
- **Outline / Secondary:** white fill, `#d1d5db` border, Ink-Soft text, hover `#f9fafb`.
- **Focus:** `2px` Register-Blue ring, always visible. The register is keyboard- and scanner-driven; focus is never removed.
- **Touch:** register controls are ≥ 44px tall.

### Chips (category / filter pills)
- **Style:** rounded `12px`, hairline border. Unselected: `#f9fafb` fill, Muted text. Selected: `#eff6ff` fill, `#1d4ed8` text, blue-200 ring.
- **Count badge:** small `pill` set in `text-[10px]`, tint-on-tint with its chip.

### Cards / Containers
- **Corner Style:** `8px` (`card`) back office; `16px` (`surface`) for register panels.
- **Background:** Surface white (`#ffffff`), dark theme `#1f2937`.
- **Shadow Strategy:** see Elevation. `shadow` for back-office cards; `shadow-lg`+ only at the register.
- **Border:** `1px` Hairline (`#e5e7eb`). Full borders only; never a colored side-stripe.
- **Internal Padding:** `16px 24px` (header/body rhythm), `lg` for sheets.

### Inputs / Fields
- **Style:** white fill, `1px` `#d1d5db` border, `6px` radius. Quantity/price inputs at the register are `font-bold` and right-aligned for money.
- **Focus:** border shifts to Register Blue (`#3b82f6`) plus a `2px` blue ring (`focus:ring-2`). Selected-row inputs tint their border to match the row's state (blue for standard, green for weighed).
- **Placeholder:** must meet 4.5:1; use Muted, not a light gray.

### Navigation
- **Style:** persistent left sidebar (collapses to an overlay below `lg`). Items are icon + Russian label (Heroicons, outline style, one icon family).
- **States:** default Muted text; hover tints the row; active item carries Register Blue text/indicator. Mobile uses a slide-over with a `bg-black/50` scrim.

### Signature Component: the Register Total
The running total and payment-due amount are the system's defining element:
Register Blue, `font-black` (900), `text-3xl` up to `text-5xl`, right-aligned
with tabular figures. It is deliberately the loudest thing on any register
screen. Treat it as a fixed law, not a styling choice.

## 6. Do's and Don'ts

### Do:
- **Do** keep Register Blue (`#2563eb`) for action, current selection, focus, and money; keep Confirm Green (`#16a34a`) for completion and payment only.
- **Do** set every currency total in Register Blue at the heaviest weight in its context (the Money-Is-Blue Rule).
- **Do** keep muted text at or above Muted (`#4b5563`) on white; bump toward Ink when contrast is close.
- **Do** keep surfaces flat at rest; reserve `shadow-lg`+ for the register action zone and modals.
- **Do** use one type family (Inter) and build hierarchy from weight and size.
- **Do** give register controls ≥ 44px touch targets and an always-visible `2px` focus ring (keyboard- and scanner-driven).
- **Do** honor `prefers-reduced-motion`: motion conveys state (150–250ms), and degrades to a crossfade or instant change.
- **Do** use full borders, background tints, or leading icons for emphasis.

### Don't:
- **Don't** ship the generic default-Tailwind look this app started from: stock `blue-600` on `gray-50` with drop-shadow cards and gray-on-gray tables. That is the named anti-reference.
- **Don't** look like a dated enterprise POS: tiny dense buttons, cluttered toolbars, text unreadable across a counter.
- **Don't** introduce a third decorative accent hue (the Two-Accent Rule). Red is a warning, not an accent.
- **Don't** use `gray-400` or lighter for any text a user must read; it fails AA under store glare (the Muted Floor Rule).
- **Don't** set all-caps body copy. All-caps is only for `text-xs` table headers and status chips.
- **Don't** add a second display typeface; weight contrast in Inter does the job.
- **Don't** put a heavy shadow on a back-office card; flat-by-default holds outside the register zone.
- **Don't** use a `border-left`/`border-right` colored stripe as an accent on cards, list items, or alerts.
- **Don't** remove focus outlines; the POS is operated by keyboard and barcode scanner.
