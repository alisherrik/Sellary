# Receipt-Print Control (Settings Toggle) — Design

**Date:** 2026-06-25
**Status:** Approved (approach confirmed by user)
**Scope:** `sellary-frontend` only

## Problem

On the POS ("Sales") page, every completed sale unconditionally calls
`printReceipt(sale)` ([utils.ts:53](../../../sellary-frontend/src/lib/utils.ts)),
which opens a window and calls `window.print()`. The browser's print dialog
defaults its destination to **"Save as PDF"**, so the cashier keeps getting an
unwanted PDF prompt. There is no way to turn receipt printing off, and no
per-store control.

The user wants:
1. Receipt printing controllable from **Settings**.
2. When printing is **enabled** → the receipt prints; when **not** → nothing
   prints (no PDF, no dialog).
3. No PDF output.

## Constraint (why no in-app printer dropdown)

A web browser **cannot** enumerate installed printers or silently send a job to
a named printer chosen in-app. `window.print()` always targets the OS default
printer / dialog. True "pick printer from a list and print silently" is an
OS-native capability (would require the Tauri desktop app). Therefore the
in-app control is a **boolean toggle**, not a printer picker. Direct, dialog-free
printing is achieved at the OS/browser level (Windows default printer + Chrome
`--kiosk-printing`), documented as a one-time setup.

## Design

### 1. Settings store (`src/store/settingsStore.ts`)
Add persisted state:
- `receiptPrintEnabled: boolean` — default **`false`**.
- `setReceiptPrintEnabled(enabled: boolean): void`.

Persisted in the existing `settings-storage` localStorage key alongside
`currency`. Default `false` means: after deploy, nothing auto-prints until the
shopkeeper explicitly enables it in Settings — directly satisfying "settingdan
tanlanganda chiqsin, bo'lmasa chiqmasin."

### 2. Settings page (`src/app/(protected)/settings/page.tsx`)
New section **«Печать чека»** (Receipt printing), styled like the existing
Currency / Release-status cards:
- A toggle switch bound to `receiptPrintEnabled`.
- Label: «Печатать чек после продажи».
- Helper text explaining: when off, no receipt/PDF is produced; when on, the
  receipt is sent to the printer. Include a short note that for dialog-free
  (no-PDF) printing the thermal printer must be set as the Windows default and
  Chrome launched with `--kiosk-printing` (link/short instructions).
- `toast.success` feedback on change (matches currency UX).

### 3. POS page (`src/app/(protected)/pos/page.tsx`)
Guard the existing print call:
```ts
if (useSettingsStore.getState().receiptPrintEnabled) {
  setTimeout(() => printReceipt(sale), 0);
}
```
Read via `getState()` (or a selector) so the checkout callback's dependency
array stays clean. Everything else in the checkout flow is unchanged. When the
toggle is off, no print window opens at all — no PDF.

### 4. One-time OS setup (documentation, no code)
Document the zero-dialog setup so "On" never shows a PDF prompt:
1. Set the thermal/receipt printer as the **default printer** in Windows.
2. Launch Chrome with `--kiosk-printing` (desktop shortcut), e.g.
   `chrome.exe --kiosk-printing --app=<POS-URL>`.
Result: `window.print()` prints straight to the default printer, silently.

Add this to the frontend `README.md` (or a short `docs/` note) and surface a
condensed hint in the Settings helper text.

## Data flow
`Settings toggle → settingsStore.receiptPrintEnabled (localStorage) → POS
checkout reads flag → printReceipt() called or skipped.`

## Error handling
- No new failure modes. If `printReceipt` is skipped, the sale still completes
  (it already runs after `resetCheckout()` on a later tick).
- `printReceipt` keeps its existing try/catch around `window.print()`.

## Testing
- **settingsStore**: unit test — default is `false`; `setReceiptPrintEnabled`
  flips and persists.
- **POS checkout**: extend [pos/page.test.tsx](../../../sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx)
  — with flag off, `printReceipt` is **not** called after a sale; with flag on,
  it **is** called. (Mock `printReceipt` from `@/lib/utils`.)
- **Settings page**: optional render test — toggle reflects and updates store.

## Out of scope (YAGNI)
- In-app printer enumeration / dropdown (browser cannot do it).
- Native/Tauri silent printing (cashier app has no POS today).
- Receipt template/format changes — current 280px thermal layout is kept.
- Per-receipt "print?" prompt at checkout — control is global via Settings.
