# Offline Mode Test Suite

Comprehensive test suite for the offline mode functionality in the Sellary frontend.

## Overview

This test suite verifies the complete offline mode system, including:

1. **Server Health Detection** - Detecting when the backend is online/offline
2. **Request Loop Prevention** - Preventing infinite requests when offline
3. **State Transitions** - Smooth switching between online and offline modes
4. **Data Consistency** - Ensuring data remains consistent across mode switches
5. **Sync Queue Management** - Queuing requests when offline and syncing when online
6. **User Experience** - Proper UI indicators and feedback

## Testing Architecture

```
tests/
├── offline-mode-e2e.spec.ts          # Playwright E2E tests
├── offline-sync.spec.ts              # Existing basic tests

src/
├── providers/__tests__/
│   └── ServerHealthProvider.test.tsx     # Server health detection tests
├── hooks/__tests__/
│   └── useQueries.test.ts               # Query hook tests
├── lib/__tests__/
│   └── syncQueue.test.ts                # Sync queue tests
└── components/__tests__/
    └── OfflineGuard.test.tsx            # Offline guard component tests
```

## Test Categories

### 1. E2E Tests (Playwright)

**File**: `tests/offline-mode-e2e.spec.ts`

Tests the complete system from the browser's perspective:
- Server health detection
- Online/offline state transitions
- Request loop prevention (CRITICAL)
- Data consistency across modes
- User experience and accessibility
- Edge cases and error handling

### 2. Unit Tests (Vitest)

#### ServerHealthProvider Tests
Tests the core health checking logic:
- Initial state and mounting
- Health check success/failure scenarios
- Network status detection
- Polling behavior (30s intervals)
- Race condition prevention
- State transitions

#### useQueries Tests
Tests the React Query hooks:
- Query execution when server is reachable
- Query disabling when server is unreachable
- Request loop prevention (CRITICAL)
- Prefetching behavior
- Different query types (sales, products, reports, etc.)

#### syncQueue Tests
Tests the offline queue management:
- Adding items to queue
- Retrieving queue
- Removing items from queue
- ID generation and timestamps
- Concurrent operations

#### OfflineGuard Tests
Tests the offline guard component:
- Rendering children when online
- Showing fallback when offline
- State transitions
- Accessibility

## Installation

First, install the test dependencies:

```bash
npm install
```

This will install:
- `@playwright/test` - E2E testing
- `vitest` - Unit testing framework
- `@testing-library/react` - React component testing
- `@testing-library/jest-dom` - Custom DOM matchers
- `happy-dom` - Lightweight DOM implementation
- `@vitest/coverage-v8` - Code coverage

## Running Tests

### Run All Unit Tests

```bash
npm test
```

### Run Unit Tests in UI Mode

```bash
npm run test:ui
```

### Run Unit Tests with Coverage

```bash
npm run test:coverage
```

Coverage report will be generated in `coverage/index.html`.

### Run E2E Tests

```bash
npm run test:e2e
```

### Run E2E Tests in UI Mode

```bash
npm run test:e2e:ui
```

### Run Specific Test File

```bash
# Unit test
npm test src/providers/__tests__/ServerHealthProvider.test.tsx

# E2E test
npm run test:e2e tests/offline-mode-e2e.spec.ts
```

### Run Tests Matching Pattern

```bash
# Run all tests with "offline" in the name
npm test -- offline

# Run only critical tests
npm test -- critical
```

## Critical Test Scenarios

### 1. Request Loop Prevention (CRITICAL)

This is the main bug being fixed. These tests verify that:

- **When offline, NO requests are made to `/api/sales` or other endpoints**
- Queries use `enabled: isServerReachable` to prevent execution
- Health check may make one request, but queries remain disabled
- Network tab should show NO requests when offline

**Test Files**:
- `tests/offline-mode-e2e.spec.ts::RequestLoopPrevention`
- `src/hooks/__tests__/useQueries.test.ts::Request Loop Prevention`

### 2. Health Check Race Conditions

Tests that queries don't fire before health check completes:

**Test Files**:
- `src/providers/__tests__/ServerHealthProvider.test.tsx::Race Conditions`

### 3. State Transitions

Tests smooth transitions between online/offline:

**Test Files**:
- `tests/offline-mode-e2e.spec.ts::Offline Mode Transitions`
- `src/providers/__tests__/ServerHealthProvider.test.tsx::State Transitions`

## Key Test Results to Verify

✅ **MUST PASS**:
- `test_no_requests_when_offline_mode` - No requests when offline
- `test_initial_mount_does_not_fire_queries_before_health_check` - Prevents race conditions
- `test_complete_offline_to_online_user_journey` - End-to-end flow
- `test_switching_to_offline_stops_all_fetches` - Stops requests on offline transition

## Target Metrics

- All critical tests passing (100%)
- Unit test coverage > 90%
- E2E coverage > 70%
- No request loops detected
- Data integrity verified

## Test File Structure

### Unit Test Template

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

describe('FeatureName', () => {
    it('should do something specific', () => {
        // Arrange
        const input = 'test';

        // Act
        const result = functionUnderTest(input);

        // Assert
        expect(result).toBe('expected');
    });
});
```

### E2E Test Template

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
    test('should do something', async ({ page }) => {
        await page.goto('http://localhost:3000');
        await expect(page.getByText('Content')).toBeVisible();
    });
});
```

## Debugging Tests

### Debug Unit Tests

```bash
# Run in watch mode
npm test -- --watch

# Run with verbose output
npm test -- --verbose

# Run specific test
npm test -- -t "test name"
```

### Debug E2E Tests

```bash
# Run with headed browser
npm run test:e2e -- --headed

# Run with debug mode
npm run test:e2e -- --debug

# Run specific test
npm run test:e2e -- -g "test name"
```

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run Unit Tests
  run: npm run test:coverage

- name: Run E2E Tests
  run: npm run test:e2e
```

## Known Issues and TODOs

### TODO: Implement These Tests

Some tests are marked as TODO and need implementation:

1. **Sync Queue Processing** - Tests for processing queued requests when coming online
2. **Sync Error Handling** - Tests for handling sync failures
3. **Idempotency Tests** - Tests for preventing duplicate sync operations
4. **Concurrent Access** - Tests for reading/writing IndexedDB concurrently
5. **Performance Tests** - Tests for large datasets and slow networks

### Test Status Legend

- ✅ Implemented and passing
- 🟡 Implemented but needs real implementation to pass
- ⚪ Not yet implemented (TODO)

## Contributing

When adding new offline mode features:

1. Write tests FIRST (TDD approach)
2. Ensure critical tests pass
3. Add coverage for edge cases
4. Test both online and offline scenarios
5. Verify no request loops occur

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [React Testing Library](https://testing-library.com/react)
- [TanStack Query Testing](https://tanstack.com/query/latest/docs/react/guides/testing)

## Contact

For questions or issues with the test suite, please refer to the main project documentation.
