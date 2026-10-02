# Аналитика shows the current period only

Date: 2026-08-15
Status: approved, small — implementing directly, no separate plan doc

## The problem

`/reports` (Аналитика) now sends an explicit `start_date` for its 7/30/90-day
buttons (the previous fix — PR #31/#33). That fix was correct: the button no
longer lies about its window. But it exposed a second problem — «30 дней» can
span a сверка boundary, blending settled and open data into one number. A
shopkeeper reads a big number crossing that boundary as a bug, not as two
periods' worth of turnover.

`/periods` already exists as the place for historical, period-bound numbers.
Аналитика's job is different: "what is happening right now." Trying to be both
— a rolling trend view AND a period-safe view — is what produces the
confusing number.

## Decision

Remove the day picker. Аналитика always shows the **current open period** —
from the last сверка to today. If the shop has never reconciled, it falls back
to the last 30 days, exactly like before any сверка existed.

This needs no backend change. `period_range` (`company_time.py`) already does
precisely this when it receives no explicit `start_date`: fills the missing
start with `today - 29 days`, then floors it at the reconciliation cut-off if
one is more recent. The bug this session fixed was that the frontend was
sending an explicit start computed from a browser-local "N days ago" — for a
page with a day-picker claiming a specific duration, that had to be honest.
For a page with no duration claim at all, the server's own floor is the
correct, non-lying answer: whatever it returns, the label under the chart
already prints the true range (`Общая выручка с ... по ...`).

## Scope

- `sellary-frontend/src/app/(protected)/reports/page.tsx` — remove the
  7/30/90 buttons and the `days` state; use a fixed `30` as the fallback
  ceiling only.
- `sellary-frontend/src/hooks/useQueries.ts` — `useDailySales` and
  `useTopProducts` stop sending `start_date` (revert to `{ days }` only).
  `useProfit` is unused by any page today; left untouched.
- `/purchase-report` has the same day-picker shape and the same latent
  confusion, but was not the page in the screenshot and has not been raised.
  Out of scope here — flagged, not touched.

## Testing

- `useQueries.test.tsx`: `useDailySales`/`useTopProducts` assertions revert to
  asserting `{ days }` only (no `start_date`).
- `reports/page.tsx` has no dedicated test file today; verified by build +
  manual reasoning about the rendered label, matching how the page was
  verified before this session's PRs.
