# Cache Speed Tiers - Final Implementation

## Overview

Your cache now has THREE speed tiers:

1. **NO_CACHE_ENTITIES** - PERMANENT CACHE (Fastest ⚡⚡⚡)
2. **CACHE_ENTITIES** - TIMED CACHE (Fast ⚡⚡)
3. **Uncached** - NO CACHE (Slow ⚡)

## Speed Comparison

### Tier 1: NO_CACHE_ENTITIES (PERMANENT - Fastest!)

```env
NO_CACHE_ENTITIES=CCustomerAccount,CCompanyInformation,CSiteSettings
```

**Speed:**

- First request: 2-5 seconds (fetch + cache)
- All subsequent requests: 10-50ms (from memory)
- **NEVER EXPIRES** - Always in memory until server restart

**When to use:**

- Static data that RARELY changes
- Company information
- Site settings
- Configuration data
- Reference data

**Pros:**

- Absolute fastest speed
- No refresh overhead
- Minimal memory churn

**Cons:**

- Data only updates on server restart or manual cache clear
- Not suitable for frequently changing data

### Tier 2: CACHE_ENTITIES (TIMED - Fast)

```env
CACHE_ENTITIES=CProduct,CCollection,CBlog
CACHE_REFRESH_INTERVAL_HOURS=24
```

**Speed:**

- First request: 2-5 seconds (fetch + cache)
- Subsequent requests: 10-50ms (from memory)
- Auto-refresh every 24 hours

**When to use:**

- Data that changes occasionally
- Products
- Collections
- Blog posts
- Categories

**Pros:**

- Fast responses
- Automatic refresh keeps data fresh
- Good balance of speed and freshness

**Cons:**

- Slight overhead during refresh
- 24-hour delay for updates (configurable)

### Tier 3: Uncached (NO CACHE - Slow)

Entities not in either list get NO cache.

**Speed:**

- Every request: 2-5 seconds (always from EspoCRM)

**When to use:**

- Real-time data
- Frequently changing data
- Data you don't want cached

**Pros:**

- Always 100% fresh
- No memory usage

**Cons:**

- Slowest option
- High load on EspoCRM

## Your Current Configuration

Based on your `.env`:

```env
CACHE_ENTITIES=CProduct,CCollection,CBlog
NO_CACHE_ENTITIES=CCustomerAccount
CACHE_REFRESH_INTERVAL_HOURS=24
```

### Speed Breakdown:

**⚡⚡⚡ PERMANENT CACHE (Fastest - Never Expires):**

- CCustomerAccount

**⚡⚡ TIMED CACHE (Fast - 24h Refresh):**

- CProduct
- CCollection
- CBlog

**⚡ NO CACHE (Slow - Always Fresh):**

- CCompanyInformation
- CSiteSettings
- CAuthor
- Lead
- CTopicPage
- CRedirect

## Recommended Configuration

### Option 1: Maximum Speed (Your Use Case)

```env
# Static data - PERMANENT cache (fastest)
NO_CACHE_ENTITIES=CCompanyInformation,CSiteSettings

# Semi-static data - TIMED cache (24h refresh)
CACHE_ENTITIES=CProduct,CCollection,CBlog,CAuthor

# Everything else - NO cache
```

### Option 2: Balanced

```env
# Very static data - PERMANENT cache
NO_CACHE_ENTITIES=CCompanyInformation,CSiteSettings

# Regular data - TIMED cache
CACHE_ENTITIES=CProduct,CCollection,CBlog,CAuthor,CTopicPage

# Real-time data - NO cache (not listed)
```

### Option 3: All Fast (Recommended for You)

```env
# Super static data - PERMANENT cache (never changes)
NO_CACHE_ENTITIES=CCompanyInformation,CSiteSettings

# Regular content - TIMED cache (changes occasionally)
CACHE_ENTITIES=CProduct,CCollection,CBlog,CAuthor,CTopicPage,CRedirect

# Only Lead is uncached (real-time)
```

## How It Works

### Startup:

```
[Cache Warmer] Starting cache warm-up for: CProduct, CCollection, CBlog, CCustomerAccount
[Cache Warmer] Permanent cache (fastest): CCustomerAccount
[Cache Warmer] Timed cache (24h): CProduct, CCollection, CBlog
[Cache Warmer] ✓ CCustomerAccount: 50 records cached (PERMANENT)
[Cache Warmer] ✓ CProduct: 120 records cached (24h TTL)
[Cache Warmer] ✓ CCollection: 15 records cached (24h TTL)
[Cache Warmer] ✓ CBlog: 8 records cached (24h TTL)
```

### During Requests:

```
[Cache HIT PERMANENT] espo:CCustomerAccount:all::
[Cache HIT TIMED] espo:CProduct:all::
[Cache SKIP] espo:Lead:all:: (entity not cached)
```

### Auto-Refresh (Only Timed Cache):

```
After 24 hours:
[Cache Warmer] Starting scheduled cache refresh (timed entities only)...
[Cache Warmer] Refreshing: CProduct, CCollection, CBlog
[Cache Warmer] Skipping: CCustomerAccount (permanent cache)
```

## Cache Management

### Clear All Cache:

```bash
curl -X DELETE http://localhost:3000/api/cache/all
```

### Clear Specific Entity:

```bash
curl -X DELETE http://localhost:3000/api/cache/entity/CCustomerAccount
```

### View Cache Stats:

```bash
curl http://localhost:3000/api/cache/stats
```

## Performance Metrics

### NO_CACHE_ENTITIES (Permanent):

- Response time: 10-50ms
- Memory: Constant (never cleared)
- Freshness: Only on restart or manual clear
- Best for: Static data

### CACHE_ENTITIES (Timed):

- Response time: 10-50ms
- Memory: Refreshed every 24h
- Freshness: Auto-refresh every 24h
- Best for: Semi-static data

### Uncached:

- Response time: 2000-5000ms
- Memory: None
- Freshness: Always current
- Best for: Real-time data

## Important Notes

1. **NO_CACHE_ENTITIES = FASTEST** (permanent cache, never expires)
2. **CACHE_ENTITIES = FAST** (timed cache, 24h refresh)
3. **Not listed = SLOW** (no cache, always fresh)

4. Permanent cache only updates on:
   - Server restart
   - Manual cache clear
   - CREATE/UPDATE/DELETE via your API

5. Timed cache updates on:
   - Auto-refresh (every 24h)
   - Server restart
   - Manual cache clear
   - CREATE/UPDATE/DELETE via your API

## Testing

Start your server and watch the logs:

```bash
npm start
```

You should see which entities use permanent vs timed cache!
