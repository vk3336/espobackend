# Fresh Data Optimization Guide

## Problem Solved

Get **always fresh data** from NO_CACHE entities (CWishlist, CCustomerAccount) while keeping responses **fast** during traffic bursts.

## Solution: Two-Layer Protection

### 1. In-Flight De-Duplication (Single-Flight Pattern)

When multiple users request the same endpoint simultaneously, they share a single EspoCRM request instead of making duplicate calls.

**How it works:**

```
Time 0ms:  User A requests /api/wishlist → Starts EspoCRM request
Time 50ms: User B requests /api/wishlist → Waits for User A's request
Time 100ms: User C requests /api/wishlist → Waits for User A's request
Time 500ms: EspoCRM responds → All 3 users get the same response
```

**Result:** 1 EspoCRM call instead of 3!

### 2. Optional Short Cache (Configurable)

Set `NO_CACHE_SHORT_TTL_SECONDS=0` for always fresh data, or use a short TTL (2-10 seconds) for additional speed.

## Configuration

### Always Fresh (Recommended for Wishlist)

```env
NO_CACHE_ENTITIES=CCustomerAccount,CWishlist
NO_CACHE_SHORT_TTL_SECONDS=0
INFLIGHT_DEDUP_ENABLED=true
```

**Behavior:**

- ✅ Always fetches fresh data from EspoCRM
- ✅ Fast during burst traffic (in-flight de-dup)
- ✅ No stale data ever

### Fresh with Short Cache (Alternative)

```env
NO_CACHE_ENTITIES=CCustomerAccount,CWishlist
NO_CACHE_SHORT_TTL_SECONDS=5
INFLIGHT_DEDUP_ENABLED=true
```

**Behavior:**

- ✅ Data max 5 seconds old
- ✅ Even faster during sustained traffic
- ⚠️ Slight staleness acceptable

## Performance Comparison

| Configuration          | Freshness  | Speed         | Use Case                |
| ---------------------- | ---------- | ------------- | ----------------------- |
| `TTL=0` + In-flight    | 100% fresh | Fast on burst | Wishlist, Cart, Orders  |
| `TTL=5` + In-flight    | Max 5s old | Faster        | User profiles, Settings |
| `TTL=0` + No in-flight | 100% fresh | Slow on burst | ❌ Not recommended      |

## Production Deployment (Vercel)

Add these environment variables in Vercel dashboard:

1. `NO_CACHE_ENTITIES` = `CCustomerAccount,CWishlist`
2. `NO_CACHE_SHORT_TTL_SECONDS` = `0`
3. `INFLIGHT_DEDUP_ENABLED` = `true`

Then redeploy.

## How In-Flight De-Dup Works

```javascript
// Multiple concurrent requests
Request 1: GET /api/wishlist → Creates promise, stores in Map
Request 2: GET /api/wishlist → Finds existing promise, waits
Request 3: GET /api/wishlist → Finds existing promise, waits

// Single EspoCRM call
→ EspoCRM responds once
→ All 3 requests get the same response
→ Promise removed from Map
```

## Monitoring

Check logs for in-flight de-duplication:

```
[espoRequest] Using in-flight request: GET:https://espo.example.com/api/v1/CWishlist:
```

If you see this log, it means duplicate requests were prevented!

## Troubleshooting

**Q: Still slow on production?**
A: Vercel free tier has cold starts. First request after 5 minutes of inactivity will be slow. Use the cron job in `vercel.json` to keep server warm.

**Q: Want to disable in-flight de-dup?**
A: Set `INFLIGHT_DEDUP_ENABLED=false` (not recommended)

**Q: How to test?**
A: Make multiple simultaneous requests to the same endpoint and check logs for "Using in-flight request"
