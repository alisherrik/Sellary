# Performance Optimization Report

This document outlines the performance improvements implemented in the Sellary POS frontend to achieve a native-app-like experience.

## Key Improvements

### 1. Instant Navigation (Zero-Latency Transitions)
*   **Strategy**: Implemented **Hover Prefetching** using `@tanstack/react-query`.
*   **Implementation**: 
    *   The `Layout` component now detects when a user hovers over sidebar navigation links.
    *   It triggers a background fetch for that page's data (e.g., hovering over "Products" fetches the product list immediately).
    *   By the time the user clicks, the data is likely already in the cache, resulting in an instant render.

### 2. Perceived Performance (Skeleton Screens)
*   **Strategy**: Replaced blocking spinners with **Skeleton UI** components that mimic the page layout.
*   **Benefits**: Reduces perceived wait time and prevents layout shifts (CLS).
*   **Components Created**:
    *   `TableSkeleton`: Used in Products, Sales, Suppliers, Purchase Orders.
    *   `CardSkeleton`: Used in Dashboard stats.
    *   `ChartSkeleton`: Used in Reports.

### 3. Caching & State Management
*   **Strategy**: Centralized data fetching with **TanStack Query**.
*   **Configuration**:
    *   `staleTime: 60000` (1 minute): Data is considered fresh for 1 minute, preventing redundant re-fetches on navigation.
    *   `gcTime: 300000` (5 minutes): Unused data remains in memory for 5 minutes.
    *   **Invalidation**: Critical actions (Create/Update/Delete) automatically invalidate the cache, ensuring data consistency without manual refetches.

### 4. Optimized Heavy Pages
*   **Reports**: Use lazy loading (`next/dynamic`) for heavy Chart components.
*   **POS**: The `ProductDrawer` now shares the same cache as the Products page, ensuring product lists open instantly.

## Codebase Changes

### New Hooks (`src/hooks/useQueries.ts`)
*   `useProducts`, `useSales`, `useSuppliers`, `usePurchaseOrders`, `useDashboard`, `useReports`
*   Generic `usePrefetch` hook for Layout.

### Provider Setup
*   `QueryProvider` wrapping the application in `src/app/layout.tsx`.

## How to Verify
1.  Hover over the sidebar links. Open the Network tab in DevTools to see the prefetch requests.
2.  Click the link. The page should appear instantly without a full loading spinner.
3.  Refresh a page to see the new Skeleton screens.
