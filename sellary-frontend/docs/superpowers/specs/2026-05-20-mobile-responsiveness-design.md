# Mobile Responsiveness Overhaul — Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Goal:** Transform Sellary frontend into a fully mobile-friendly app with a native-like (Flutter-style) experience on all pages.

---

## 1. Requirements Summary

| # | Requirement | Decision |
|---|---|---|
| R1 | Scope | All pages at once |
| R2 | Mobile navigation | Bottom tab bar (5 tabs) |
| R3 | Scrolling behavior | Viewport-contained — no page-level scrolling |
| R4 | Desktop layout | Keep sidebar, unchanged |
| R5 | Mobile breakpoint | `< 768px` (md) |
| R6 | Tab bar contents | POS, Products, Sales, Dashboard, More |

---

## 2. Architecture

```
RootLayout (app/layout.tsx)
├── Desktop (>= 768px) — current Layout.tsx with sidebar
└── Mobile (< 768px) — new MobileShell
    ├── MobileHeader (fixed top, back button + title, 56px)
    ├── PageContent (flex-1, overflow-hidden, viewport-contained)
    └── BottomTabBar (fixed bottom, 5 tabs, 64px)
        └── MoreSheet (animated slide-up bottom sheet for remaining pages)
```

### Layout switching

In `(protected)/layout.tsx`, detect screen width and conditionally render:

```
if (isMobile) → <MobileShell>{children}</MobileShell>
else → <Layout>{children}</Layout>
```

`isMobile` determined via `useMediaQuery('(max-width: 767px)')` or a similar hook.

---

## 3. New Components

### 3.1 `MobileShell`

**Location:** `src/components/mobile/MobileShell.tsx`

Orchestrator component. Renders `MobileHeader` + `ViewportPage` + `BottomTabBar`.

- Reads current pathname to determine header title and back button visibility
- Passes headerProps and tabBarProps to children

### 3.2 `MobileHeader`

**Location:** `src/components/mobile/MobileHeader.tsx`

- **Height:** 56px
- **Left:** Back button (←) — visible on sub-pages (path depth > 1)
- **Center:** Page title (text-lg, font-semibold)
- **Right:** Optional slot for action buttons (search icon, + add button)
- **Sticky:** Part of the fixed viewport layout, not independently sticky
- **Background:** white, subtle bottom shadow

Props:

```
{
  title: string
  showBack?: boolean
  onBack?: () => void
  actions?: ReactNode
}
```

### 3.3 `BottomTabBar`

**Location:** `src/components/mobile/BottomTabBar.tsx`

- **Height:** 64px (56px content + 8px safe area bottom padding)
- **Background:** white, top border (border-t border-gray-200)
- **Tabs (5):**

| Tab | Icon | Route | Active Color |
|---|---|---|---|
| Касса | ShoppingBagIcon | `/pos` | blue-600 |
| Товары | CubeIcon | `/products` | blue-600 |
| Продажи | ArrowUturnLeftIcon | `/sales` | blue-600 |
| Дашборд | HomeIcon | `/dashboard` | blue-600 |
| Ещё | EllipsisHorizontalIcon | opens MoreSheet | — |

- Active state: filled icon + bold label (text-[10px])
- Inactive: outlined icon + regular label, gray-500
- Tap navigates via `router.push()`, not swipe
- `Ещё` tab opens `MoreSheet` instead of navigating

### 3.4 `MoreSheet`

**Location:** `src/components/mobile/MoreSheet.tsx`

Animated bottom sheet listing secondary nav items.

- **Animation:** Slide up with spring easing, 300ms
- **Backdrop:** bg-black/60, tap to dismiss
- **Height:** Auto-fit content, max 60vh
- **Handle:** 32x4px gray pill at top center
- **Items:**
  - Поставщики → `/suppliers`
  - Закупки → `/purchase-orders`
  - Отчеты → `/reports`
  - Настройки → `/settings`
- Tap an item navigates and closes the sheet
- Conditional: show Restaurant → `/restaurant` if `isRestaurantEnabled`

Uses existing CSS animations (`animate-slide-up`) from `globals.css`.

### 3.5 `ViewportPage`

**Location:** `src/components/mobile/ViewportPage.tsx`

Wrapper for page content that constrains to viewport with internal scrolling.

- Height: `calc(100dvh - 56px - 64px)`
- `overflow-y-auto` on content area
- Uses `100dvh` (dynamic viewport height) for mobile browser address bar handling
- Safe area bottom padding via `env(safe-area-inset-bottom)`

Props:

```
{
  children: ReactNode
  headerTitle: string
  showBack?: boolean
  onBack?: () => void
  headerActions?: ReactNode
  bottomBar?: ReactNode  // for page-specific bottom bars (e.g., POS total bar)
}
```

---

## 4. Page Migrations

### 4.1 POS (`/pos`) — Medium Complexity

- Already uses `h-[calc(100vh-80px)]` — replace with `ViewportPage`
- Remove desktop header dependency (date, company name in header)
- Keep the existing cart layout, product drawer, payment modal structure intact
- Adjust heights: current `calc(100vh-80px)` → handled by ViewportPage automatically
- Payment modal already uses bottom-sheet pattern on mobile (`items-end`)
- The `+ Товар` button and total bar stay as page-level bottom bar inside ViewportPage

### 4.2 Dashboard (`/dashboard`) — Medium Complexity

- Wrap in `ViewportPage`
- KPI cards become a horizontal scrollable row at top (sticky or just first element)
- Charts/graphs scroll below
- Replace any full-page scroll with internal `overflow-y-auto`

### 4.3 Products (`/products`) — High Complexity

- **Table → Card list:** Each product becomes a card with:
  - Product name (bold)
  - Category badge
  - Price, stock quantity, UOM
  - Action buttons as icons or swipe-to-reveal
- **Category filter:** Horizontal scrollable pill bar below header
- **Search:** Icon in header actions, expands to input on tap
- **Add/Edit modals:** Current modal pattern → Bottom sheet with form
- **Delete:** Confirm dialog stays as modal

### 4.4 Sales History (`/sales`) — High Complexity

- **Table → Card list:** Each sale becomes a card:
  - Sale ID, date, total amount
  - Payment method badge
  - Collapsible item list
- **Detail view:** Bottom sheet instead of modal
- **Return flow:** Return modal → Bottom sheet with return quantity inputs
- **Filters:** Date range as collapsible header section

### 4.5 Suppliers (`/suppliers`) — Medium Complexity

- Same pattern as Products: table → card list
- Supplier name, contact info, product count on card
- Add/Edit → Bottom sheet form

### 4.6 Purchase Orders (`/purchase-orders`) — Medium Complexity

- Table → Card list with status badges
- Receive modal → Bottom sheet
- Create/Edit PO → Bottom sheet form

### 4.7 Reports (`/reports`) — Low Complexity

- Already card-based. Just wrap in ViewportPage.
- Chart containers scale to fill width

### 4.8 Settings (`/settings`) — Low Complexity

- Form sections wrap in ViewportPage with internal scroll
- No table conversion needed

### 4.9 Login (`/login`) — Low Complexity

- Already centered card layout
- Minor spacing adjustments for mobile
- No ViewportPage needed (login has no tab bar)

---

## 5. Data Flow

**No changes to data layer.** Zustand store, TanStack Query hooks, API calls remain identical.

- `(protected)/layout.tsx` conditionally renders based on screen width
- All pages consume the same hooks and stores regardless of layout
- Query invalidation and refetching unchanged

---

## 6. Mobile Patterns

### Table → Card List Conversion

Pattern: Each table row becomes a card with key-value pairs.

```
<div className="space-y-2 overflow-y-auto">
  {items.map(item => (
    <div className="rounded-xl bg-white p-4 shadow-sm border">
      <div className="flex justify-between items-start">
        <p className="font-semibold text-sm">{item.name}</p>
        <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{category}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>Price: {price}</span>
        <span>Stock: {stock}</span>
      </div>
      <div className="mt-2 flex gap-2 justify-end">
        {actions}
      </div>
    </div>
  ))}
</div>
```

### Bottom Sheet Pattern

Replace desktop modals with bottom sheets on mobile. Reuse existing `animate-slide-up` animation.

- Position: `fixed inset-0 z-50 flex items-end`
- Content: `rounded-t-3xl bg-white max-h-[85vh] overflow-y-auto`
- Backdrop: `absolute inset-0 bg-black/60`
- Handle pill at top for visual affordance

### Touch Targets

All interactive elements must be >= 44x44px:
- Buttons: min 44px height
- Icons in lists: 44x44px hit area (pad smaller icons)
- Form inputs: min 44px height
- Tab bar items: 56px touch area

### Filter Pills

Horizontal scrollable category/status filters as pill bar:
- `flex gap-2 overflow-x-auto scrollbar-hide px-4`
- Each pill: rounded-full, px-3 py-1.5, text-xs
- Active: bg-blue-600 text-white
- Inactive: bg-gray-100 text-gray-600

---

## 7. Component File Structure

```
src/components/mobile/
├── MobileShell.tsx
├── MobileHeader.tsx
├── BottomTabBar.tsx
├── MoreSheet.tsx
├── ViewportPage.tsx
└── __tests__/
    ├── MobileShell.test.tsx
    ├── BottomTabBar.test.tsx
    └── MoreSheet.test.tsx
```

---

## 8. Modifications to Existing Files

| File | Change |
|---|---|
| `src/components/Layout.tsx` | Add `isMobile` check at top; return children on mobile (delegate to MobileShell in layout.tsx) |
| `src/app/(protected)/layout.tsx` | Add `useMediaQuery`; conditionally render `<MobileShell>` vs `<Layout>` |
| `src/app/globals.css` | Add mobile-specific safe area utilities, viewport height utility classes if needed |
| Each page `page.tsx` | Wrap content in `ViewportPage`; convert tables → card lists on mobile |
| `package.json` | No new dependencies required. All patterns use existing Tailwind + Heroicons. |

---

## 9. Testing Plan

| Type | What | Coverage target |
|---|---|---|
| Unit | `MobileShell`, `BottomTabBar`, `MoreSheet`, `MobileHeader` component tests | Render + navigation + state |
| Integration | Layout switching (desktop vs mobile rendering) | verify correct shell at each breakpoint |
| Visual | Card list conversions vs original tables | Snapshot or visual regression |
| Accessibility | Touch targets >= 44px, tab order, ARIA labels | Manual audit |
| E2E | Key flows: POS sale, product CRUD, sale return on mobile | Playwright mobile viewport |

---

## 10. Edge Cases & Gotchas

- **Keyboard avoidance:** iOS Safari pushes viewport up when keyboard opens. Use `100dvh` and test on real devices.
- **Safe area:** Test on iPhone with notch (simulator). `env(safe-area-inset-bottom)` must be applied to BottomTabBar and any fixed-bottom elements.
- **Orientation change:** `useMediaQuery` + resize listener handles tab bar re-render on rotate.
- **Deep linking:** Sub-pages accessed directly must show back button in MobileHeader. Detect via pathname depth.
- **Offline mode:** SyncStatusPanel should be inline or minimized on mobile (not a full banner).
- **Restaurant module:** Hidden by default (`isRestaurantEnabled`). If enabled, show in MoreSheet and optionally as a tab.
- **PWA:** Existing `@ducanh2912/next-pwa` already configured. Add `manifest.json` with `display: standalone` for app-like feel.
- **Browser back vs in-app back:** Use `router.back()` in MobileHeader for natural back navigation. Tab bar navigates forward.

---

## 11. Out of Scope

- Dark mode mobile optimization (dark mode exists but not required for this phase)
- Pull-to-refresh gesture
- Swipe between tabs
- Native mobile app (React Native/Flutter)
- Offline mode UX improvements
- Restaurant module mobile redesign (disabled by default)
