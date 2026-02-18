# Vercel Cold Start Optimization - CRITICAL FIX

## The Problem

On Vercel (serverless), the first request after a cold start was taking 5-10 seconds because:

1. **Cache Warmer** - Loading all entities (CProduct, CCollection, CBlog)
2. **IndexNow Scheduler** - Initializing cron jobs
3. **Your API Request** - Finally processing the actual request

**Result:** Users waited 8+ seconds for the first request!

## The Solution

### Critical Fix: Disable Blocking Startup Jobs

```env
RUN_STARTUP_JOBS=false
```

**What this does:**

- ✅ Skips cache warming on cold start
- ✅ Skips scheduler initialization
- ✅ First request responds in ~2 seconds instead of 8+
- ✅ Cache populates on-demand as requests come in

### Before vs After

**Before (SLOW):**

```
Cold Start → Cache Warmer (5s) → IndexNow (1s) → API Request (2s) = 8s total 🐌
```

**After (FAST):**

```
Cold Start → API Request (2s) = 2s total ⚡
```

## Complete Vercel Configuration

Add these to your Vercel environment variables:

```env
# Always fresh data for wishlist/customer accounts
NO_CACHE_ENTITIES=CCustomerAccount,CWishlist
NO_CACHE_SHORT_TTL_SECONDS=0

# Prevent duplicate requests during bursts
INFLIGHT_DEDUP_ENABLED=true

# CRITICAL: Disable blocking startup jobs on serverless
RUN_STARTUP_JOBS=false
```

## How It Works

### Startup Jobs Disabled (Serverless)

- Server starts instantly
- No cache warming
- No scheduler initialization
- Cache populates lazily as requests come in

### Startup Jobs Enabled (Always-On Servers)

- Server pre-warms cache on startup
- Schedulers run in background
- First request is slower, but subsequent requests are faster
- Use this for Railway, DigitalOcean, Heroku

## When to Use Each Setting

| Platform          | RUN_STARTUP_JOBS | Why                       |
| ----------------- | ---------------- | ------------------------- |
| Vercel            | `false`          | Serverless, cold starts   |
| Netlify Functions | `false`          | Serverless, cold starts   |
| AWS Lambda        | `false`          | Serverless, cold starts   |
| Railway           | `true`           | Always-on, no cold starts |
| DigitalOcean      | `true`           | Always-on, no cold starts |
| Heroku            | `true`           | Always-on, no cold starts |

## Monitoring

### Good Logs (Fast Cold Start)

```
[Startup] Skipping background jobs (RUN_STARTUP_JOBS=false)
[Startup] Cache will populate on-demand as requests come in
[Startup] Server ready!
```

### Bad Logs (Slow Cold Start)

```
[Cache Warmer] Starting cache warm-up... Loading CProduct...
[Cache Warmer] Fetching CProduct records...
[IndexNow Scheduler] ... Scheduled successfully
```

If you see "Cache Warmer" or "IndexNow Scheduler" in your Vercel logs during a request, `RUN_STARTUP_JOBS` is not properly set to `false`.

## Testing

1. Deploy to Vercel with `RUN_STARTUP_JOBS=false`
2. Wait 5 minutes (to trigger cold start)
3. Hit `/api/wishlist`
4. Check Vercel logs - should NOT see cache warmer
5. Response should be ~2 seconds, not 8+

## Additional Optimizations

### 1. In-Flight De-Duplication

Already enabled with `INFLIGHT_DEDUP_ENABLED=true`

Prevents duplicate EspoCRM calls when multiple users hit the same endpoint simultaneously.

### 2. Keep Server Warm (Optional)

Your `vercel.json` already has a cron job:

```json
{
  "crons": [{ "path": "/health", "schedule": "0 2 */2 * *" }]
}
```

This pings your server every 2 days. To keep it warmer, change to:

```json
{
  "crons": [{ "path": "/health", "schedule": "*/5 * * * *" }]
}
```

This pings every 5 minutes (prevents most cold starts, but uses more function invocations).

## Summary

**The fix is simple:** Set `RUN_STARTUP_JOBS=false` in Vercel environment variables.

This single change drops cold start time from 8+ seconds to ~2 seconds! 🚀
