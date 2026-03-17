# Server-First Offline Mode Design

## Overview

The offline mode system is designed to be **server-health driven**, not browser-internet driven. This is crucial for local development and local server deployments.

## Architecture Decision

### ❌ Previous Approach (Browser-Driven)
```
Browser Offline → Immediately Set Offline
Browser Online → Immediately Set Online
Server Health → Secondary Check
```

**Problems:**
- Browser's `navigator.onLine` doesn't detect local servers
- Can incorrectly show "offline" when localhost is running
- Blocks functionality even when server is reachable

### ✅ Current Approach (Server-Driven)
```
Server Health Check → PRIMARY Source of Truth
Browser Online State → Information Only
```

**Benefits:**
- ✅ Works perfectly with localhost/127.0.0.1
- ✅ Works with local network servers
- ✅ Accurate detection regardless of internet status
- ✅ Server health is the only factor that matters

## How It Works

### Health Check Process

```
1. App Starts
   ├─ Initial State: isChecking=true, isServerReachable=false
   ├─ Show Loading Spinner
   └─ Start Health Check

2. Health Check Runs (Always)
   ├─ Fetch /api/health?_t={timestamp}
   ├─ Response 200-499 → Set isServerReachable=true
   ├─ Response 500+ → Set isServerReachable=false
   └─ Network Error → Set isServerReachable=false

3. State Determined
   ├─ isChecking=false
   ├─ Show Content if reachable
   └─ Show Offline UI if unreachable
```

### Event Handling

**Browser Online Event:**
```javascript
window.addEventListener('online', () => {
    setIsNavigatorOnline(true);
    checkHealth(); // Re-verify server
});
```

**Browser Offline Event:**
```javascript
window.addEventListener('offline', () => {
    setIsNavigatorOnline(false);
    checkHealth(); // Still check server (might be localhost)
});
```

**Periodic Heartbeat:**
```javascript
setInterval(checkHealth, 30000); // Every 30 seconds
```

## Real-World Scenarios

### Scenario 1: Local Development (localhost)
```
Internet Status: OFF (WiFi disconnected)
Server Status: RUNNING (localhost:3000)
Browser: navigator.onLine = false

Result: ✅ APP WORKS
- Browser reports offline
- BUT health check to http://localhost:3000/api/health succeeds
- isServerReachable = true
- User can work normally
```

### Scenario 2: Server Down
```
Internet Status: ON
Server Status: DOWN (crashed/not running)
Browser: navigator.onLine = true

Result: ❌ OFFLINE MODE
- Browser reports online
- BUT health check fails
- isServerReachable = false
- Shows offline UI
```

### Scenario 3: Both Working
```
Internet Status: ON
Server Status: RUNNING
Browser: navigator.onLine = true

Result: ✅ ONLINE MODE
- Health check succeeds
- Everything works
```

### Scenario 4: Internet Flaky
```
Internet Status: ON/OFF/ON/OFF (unstable)
Server Status: RUNNING (stable)

Result: ✅ APP STABLE
- Browser events trigger re-checks
- Server is always reachable
- User experiences no interruptions
```

## Configuration

### Health Check Endpoint
The system fetches: `/api/health?_t={timestamp}`

**Response Codes:**
- `200-499` → Server REACHABLE ✅
- `500+` → Server UNREACHABLE ❌

**Timeout:** 5 seconds

**Cache Busting:** Timestamp parameter prevents caching

### Polling Intervals
- **When Online:** Every 30 seconds
- **When Offline:** Every 30 seconds
- **On Browser Events:** Immediate re-check

## Implementation Details

### ServerHealthProvider State

```typescript
interface ServerHealthContextType {
    isServerReachable: boolean;  // Can I fetch data from server?
    isNavigatorOnline: boolean;   // Is browser online? (info only)
    isChecking: boolean;          // Is health check in progress?
    checkHealth: () => Promise<void>;
}
```

### State Transitions

```
Initial → Checking → Reachable/Unreachable
                    ↓
                Health Check (always runs)
```

## Why This Design?

### 1. **Local Development**
Developers often work on `localhost` or `127.0.0.1` without internet. Browser would incorrectly report "offline".

### 2. **Local Network Deployments**
In restaurants/shops, the server might be on local network (`192.168.1.100`). Browser internet status doesn't matter.

### 3. **Reliability**
Server is the actual source of data. If server is down, we are offline. Period.

### 4. **Accuracy**
Browser's `navigator.onLine` is unreliable:
- Returns `true` when connected to VPN that has no internet
- Returns `false` when some but not all network interfaces are down
- Doesn't detect local servers

## Testing

The test suite verifies this behavior:

```typescript
// Test: Server reachable even when browser offline
it('should work with localhost when browser offline', async () => {
    // Simulate browser offline
    Object.defineProperty(navigator, 'onLine', { value: false });

    // But server is up
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    // Should be reachable
    expect(result.isServerReachable).toBe(true);
});
```

## Monitoring

To monitor offline mode effectiveness:

```typescript
const { isServerReachable, isNavigatorOnline } = useServerHealth();

console.log('Browser Online:', isNavigatorOnline);
console.log('Server Reachable:', isServerReachable);

// These can be different! That's expected and correct.
// isServerReachable is what matters for functionality.
```

## Benefits Summary

✅ **Works offline-locally** - No internet required for local development
✅ **Accurate detection** - Server health is the only metric that matters
✅ **Better UX** - No false "offline" when server is actually reachable
✅ **Simpler mental model** - Server up = online, server down = offline
✅ **Robust** - Works in all network configurations
