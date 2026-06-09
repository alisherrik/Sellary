---
target: pos
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-06-09T17-12-35Z
slug: sellary-frontend-src-app-protected-pos-page-tsx
---
# Critique: POS / Касса

`sellary-frontend/src/app/(protected)/pos/page.tsx`

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toasts + loading + server-reachable guard solid; hotkeys give no visible hint |
| 2 | Match System / Real World | 4 | Natural Russian, standard POS metaphors |
| 3 | User Control and Freedom | 2 | No Esc to close payment modal; destructive clear has no undo |
| 4 | Consistency and Standards | 3 | Blue-tint selection for payment method vs per-brand hues for card type |
| 5 | Error Prevention | 2 | Clearing qty field deletes the line; one-tap clear cart and tab-close wipe data |
| 6 | Recognition Rather Than Recall | 3 | Icons labeled, options visible; hotkeys undiscoverable |
| 7 | Flexibility and Efficiency | 3 | Multi-session carts, inline price edit, hotkeys; held back by no Esc |
| 8 | Aesthetic and Minimalist | 3 | Clean on-brand money display; purple card type + tiny low-contrast labels add noise |
| 9 | Error Recovery | 3 | Errors surface server detail and preserve the cart on failure |
| 10 | Help and Documentation | 1 | None; hotkeys never surfaced |
| **Total** | | **27/40** | **Acceptable (top edge)** |

## Anti-Patterns Verdict

Mostly does NOT look AI-generated: real multi-session cart tabs, keyboard hotkeys, inline per-line price editing. No gradient text, glass, eyebrows, or identical-card grid. Money display (font-black text-blue-600, up to text-5xl) matches the Money-Is-Blue rule.

Deterministic scan (detect.mjs): 2 warnings, both ai-color-palette at line 569 (text-purple-600 / text-purple-500 on the "DC" card-type heading). Not a false positive: genuine off-system color that violates the Two-Accent Rule in DESIGN.md.

Visual overlays: not run (no dev server running; not started).

## Overall Impression

The register's core is good, better than the back-office screens: hierarchy is right (total dominates), power-user affordances are real. The problems are safety and accessibility, not aesthetics. A cashier mid-rush can destroy a sale by clearing a quantity field or fat-fingering one button, and several critical labels are unreadable under glare. Biggest opportunity: make destructive actions hard to trigger by accident.

## What's Working

1. Money hierarchy is exemplary (text-2xl->text-5xl font-black text-blue-600 on total and К оплате).
2. Power-cashier affordances: multi-session tabs, Enter to pay/complete, F2 catalog, inline qty + price editing.
3. Accessibility scaffolding above average: role=tablist/tab, aria-selected, aria-current, aria-label on icon buttons.

## Priority Issues

- [P1] Clearing the quantity field silently deletes the line item (page.tsx:303-306). Data loss on a routine keystroke during a live sale; no undo. Fix: treat empty/invalid as a transient editing state, require explicit trash to delete, restore on blur. Command: /impeccable harden
- [P1] One-tap destructive actions with no confirm or undo. "Очистить корзину" wipes the sale (:415); closing a session tab with items deletes that cart (:226). Fix: confirm when target is non-empty, or undo toast. Command: /impeccable harden
- [P1] Sub-AA contrast and meaning-by-color-alone. Empty-state text-gray-300 (~1.6:1), "Итого" label text-gray-400 (~2.8:1) fail AA; payment method and card type distinguished only by color. Fix: floor muted text at #4b5563, add non-color selected cue. Command: /impeccable audit then /impeccable colorize
- [P2] Off-system color + inconsistent selection vocabulary. DC card type purple (:565,:569); Alif green, Eskhata blue; payment-method selection uses blue tint. Two "selected" languages in one modal. Fix: one selection pattern (blue tint + ring); drop purple; differentiate banks by name/logo. Command: /impeccable colorize
- [P2] Keyboard-first gaps. No Esc to dismiss payment modal; Enter/F2 invisible; several big buttons define no focus-visible ring while inputs do. Fix: add Esc, surface hotkey hints, standardize 2px Register-Blue focus ring. Command: /impeccable harden

## Persona Red Flags

- Alex (power cashier): hotkeys exist but no Esc to dismiss modal; no visible shortcut legend.
- Sam (accessibility / low vision): empty-state and Итого labels fail AA; selected method/card type signaled by color only; big buttons lack visible focus ring.
- Casey (touch): trash (p-1 ~24px), qty input (py-1), card-type clear (h-3 w-3) under 44px target; qty-clear-deletes is brutal on thumb keyboard.
- Dilnoza (project persona, front-line cashier): one accidental tap on Очистить корзину erases an order with no warning or undo.

## Minor Observations

- Stock check (:307) blocks overselling with a toast, but CLAUDE.md says overselling is intentionally allowed elsewhere. Inconsistent rule.
- Two labels for pay flow: "Оплатить" (opens modal) vs "Завершить продажу" (commits), both green/bold.
- :263 has a broken indent (const discountAmount flush-left).
- Disabled pay button uses bg-gray-300 with white text (low contrast).

## Questions to Consider

- What would make destroying a sale require intent, not just a tap, without slowing the happy path?
- Should "selected" ever be communicated by color alone on a register used under glare?
- What is the lightest way to make the hotkeys discoverable without clutter?
