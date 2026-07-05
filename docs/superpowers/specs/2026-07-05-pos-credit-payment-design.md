# POS Credit Payment Design

## Goal

Add a temporary `В долг` option to the POS payment modal. Credit sales remain ordinary completed sales for now, but are marked with a Russian transaction note so they can be identified later.

## User interface

- Add `В долг` as the fourth payment option beside cash, card, and mobile.
- Selecting it hides the cash-received and change controls because no immediate cash is collected.
- Card-type controls remain exclusive to card payments.
- The existing checkout button, stock validation, sale completion, cart reset, and receipt behavior remain unchanged.

## Data contract

The frontend-only `credit` selection maps to the existing backend contract:

- `payment_method: "cash"`
- no `card_type`
- `notes: "Продано в долг"`

This deliberately avoids adding a PostgreSQL enum value or migration. Existing non-credit sales do not receive this note.

## Error handling

Credit checkout uses the current sale API and current error handling. It bypasses only the frontend cash-sufficiency check; all server-side inventory and idempotency protections still apply.

## Tests

- Verify that the `В долг` option is rendered.
- Verify that selecting it hides cash-specific controls.
- Complete a credit sale and assert that the API payload uses `payment_method: "cash"`, omits `card_type`, and includes `notes: "Продано в долг"`.
- Run the complete frontend unit suite and production build.

## Out of scope

- Customer debt balances, repayment tracking, due dates, debt reports, and a dedicated backend `credit` payment enum.
