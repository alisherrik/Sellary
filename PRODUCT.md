# Product

## Register

product

## Users

**Primary: cashiers at the point of sale.** Front-line retail staff ringing up
sales for hours at a stretch, often on a touchscreen, sometimes with a barcode
scanner and keyboard, under store lighting and time pressure. The work is fast,
repetitive, and unforgiving of friction. They are not necessarily technical and
should never be made to feel they could "break" something.

**Secondary: store owners and managers.** They live in the back office,
reviewing reports and dashboards, managing products, inventory, suppliers, and
purchase orders, and configuring settings. Their work is analytical and
desktop-bound, denser and less time-critical than the cashier's.

The system is multi-company (multi-tenant): a single user may belong to several
companies and switch between them. Owners also reach a separate global owner
panel for cross-company administration.

## Product Purpose

Sellary is a retail POS, inventory, and supplier-management system. It exists to
let a small-to-mid retail business run the floor and the back office from one
tool: take sales quickly and accurately at the register, keep stock and
purchasing in order, and give owners a clear read on how the business is doing.

Success looks like: a cashier completes a sale without thinking about the
software; an owner answers "how are we doing / what do we need to reorder"
in a glance; and the same product feels coherent whether you're on the POS
screen or deep in settings.

## Brand Personality

**Fast and invisible.** The tool should disappear into the task. Three words:
calm, quick, dependable. The voice is plain and direct (UI strings are in
Russian by design), never cute, never shouting. Confidence is shown through
responsiveness and clarity, not decoration. Nothing on screen competes with the
cashier's next action or the number they need to read.

## Anti-references

- **Clunky legacy POS.** Tiny dense buttons, gray-on-gray toolbars, cluttered
  chrome, nothing readable across a counter. Do not look enterprise-dated.
- **The generic default-Tailwind look the app ships with today.** `blue-600`
  primary on `gray-50`, drop-shadow cards, stock gray tables. It reads as a
  starter template, not a considered product. Move off it deliberately.
- Not Linear/Stripe *cloned*, but their restraint and craft are the bar:
  one confident accent, tight spacing, motion that conveys state and nothing
  more. Square / Shopify POS are the reference for the register itself: big
  touch targets, totals and money you can read instantly, fast item entry.

## Design Principles

1. **The register is sacred.** On the POS screen, every pixel serves speed and
   accuracy. Big targets, unmistakable totals, the next action always obvious.
   Density and cleverness yield to legibility under pressure.
2. **One vocabulary, every screen.** A button, input, table, and modal look and
   behave the same in POS, reports, and settings. Coherence is the whole goal
   of this pass; surprise is a bug, not delight.
3. **Earned familiarity over novelty.** Use standard product affordances (side
   nav, tables, command-style entry) so a fluent user trusts the UI on sight.
   Reinvent an affordance only when the standard one genuinely fails the task.
4. **State is always visible.** Loading, success, error, empty, selected,
   disabled are designed, not afterthoughts. The user is never guessing whether
   the system heard them, especially the cashier mid-sale.
5. **Restraint carries the brand.** Calm neutral surfaces, one purposeful
   accent reserved for primary actions and current state. Color and motion earn
   their place by meaning something; flair that doesn't aid the task is removed.

## Accessibility & Inclusion

- **WCAG AA contrast** throughout: body text ≥ 4.5:1, large/bold text ≥ 3:1,
  including placeholder text. Must hold up under store glare and varied lighting.
- **Large touch targets** on interactive controls, ≥ 44px on the POS and other
  touch-reachable surfaces.
- **Keyboard-first POS.** Power cashiers work via keyboard and barcode scanner:
  full keyboard flow, logical tab order, and a clearly visible focus state are
  required, not optional.
- **Reduced motion.** Honor `prefers-reduced-motion`; motion is functional
  (state, feedback, reveal) and always degrades to a crossfade or instant state.
- Dual light/dark themes already exist; both must meet the same contrast bar.
