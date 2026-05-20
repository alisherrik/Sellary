# Mobile Responsiveness Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform all Sellary pages into a fully mobile-friendly, viewport-contained experience with bottom tab bar navigation, while preserving desktop sidebar layout.

**Architecture:** New `MobileShell` component with `MobileHeader` + viewport content + `BottomTabBar`. Layout switching in `(protected)/layout.tsx` via `useMediaQuery('(max-width: 767px)')`. Pages restructured to use internal scroll areas instead of body scroll. Tables on data pages convert to card lists on mobile.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS 3, Heroicons, Vitest + Testing Library

---

## Task Dependency Order

```
Task 1 (useMediaQuery) ──┐
Task 2 (MobileHeader) ────┤
Task 3 (BottomTabBar) ────┤──► Task 5 (MobileShell) ──► Task 6 (layout switching) ──► Tasks 8-16 (pages) ──► Task 18 (verify)
Task 4 (MoreSheet) ───────┤
Task 7 (CSS utils) ───────┤
                          │
                          └──► Task 17 (tests — can run in parallel with page migrations)
```

**Phase 1 (parallel):** Tasks 1, 2, 3, 4, 7
**Phase 2 (sequential):** Task 5 → Task 6
**Phase 3 (parallel):** Tasks 8, 9, 10, 11, 12, 13, 14, 15, 16, 17
**Phase 4:** Task 18 (final verification)

---
