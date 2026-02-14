# Cache Entity Configuration Guide

## Overview

You can now control which entities use caching and which don't using environment variables. This gives you flexibility to cache slow-changing data while keeping real-time data fresh.

## Configuration Variables

### 1. `CACHE_ENTITIES` (Whitelist)

Specify which entities should be cached. Only these entities will use cache and be warmed up on startup.

```env
# Cache only these entities
CACHE_ENTITIES=CProduct,CCollection,CBlog

# Leave empty to cache all entities (default behavior)
CACHE_ENTITIES=
```

### 2. `NO_CACHE_ENTITIES` (Blacklist)

Specify which entities should NEVER be cached. These will always fetch fresh data from EspoCRM.

```env
# Never cache these entities (real-time data)
NO_CACHE_ENTITIES=COrder,CCart,CCustomerAccount,CLead
```

### 3. `CACHE_REFRESH_INTERVAL_HOURS`

How often cached entities are automatically refreshed.

```env
# Refresh every hour
CACHE_REFRESH_INTERVAL_HOURS=1

# Refresh every 24 hours (default)
CACHE_REFRESH_INTERVAL_HOURS=24
```

## How It Works

### Priority Order:

1. **NO_CACHE_ENTITIES** (highest priority) - If entity is here, it's NEVER cached
2. **CACHE_ENTITIES** - If defined, only these entities are cached
3. **Default** - If both are empty, all entities are cached

### Examples:

#### Example 1: Cache Everything (Default)

```env
CACHE_ENTITIES=
NO_CACHE_ENTITIES=
```

Result: All entities use cache

#### Example 2: Cache Only Specific Entities

```env
CACHE_ENTITIES=CProduct,CCollection,CBlog
NO_CACHE_ENTITIES=
```

Result: Only CProduct, CCollection, and CBlog are cached. All others fetch fresh data.

#### Example 3: Cache Everything Except Real-Time Data

```env
CACHE_ENTITIES=
NO_CACHE_ENTITIES=COrder,CCart,CCustomerAccount
```

Result: All entities cached except COrder, CCart, and CCustomerAccount (always fresh)

#### Example 4: Specific Cache with Exceptions

```env
CACHE_ENTITIES=CProduct,CCollection,CBlog,COrder
NO_CACHE_ENTITIES=COrder
```

Result: CProduct, CCollection, and CBlog are cached. COrder is NOT cached (NO_CACHE takes priority)

## Use Cases

### Static/Slow-Changing Data (Use Cache)

- Products (CProduct)
- Collections (CCollection)
- Blog posts (CBlog)
- Categories
- Static pages

**Configuration:**

```env
CACHE_ENTITIES=CProduct,CCollection,CBlog
CACHE_REFRESH_INTERVAL_HOURS=24
```

### Real-Time Data (No Cache)

- Orders (COrder)
- Shopping carts (CCart)
- Customer accounts (CCustomerAccount)
- Leads (CLead)
- Inventory levels

**Configuration:**

```env
NO_CACHE_ENTITIES=COrder,CCart,CCustomerAccount,CLead,CInventory
```

### Mixed Approach (Recommended)

```env
# Cache static content
CACHE_ENTITIES=CProduct,CCollection,CBlog

# Never cache transactional data
NO_CACHE_ENTITIES=COrder,CCart,CCustomerAccount,CLead

# Refresh cached data every 2 hours
CACHE_REFRESH_INTERVAL_HOURS=2
```

## Performance Impact

### Cached Entities:

- First request: 2-5 seconds (fetch + cache)
- Subsequent requests: 10-50ms (from memory)
- Auto-refresh: Every X hours (configurable)

### Non-Cached Entities:

- Every request: 2-5 seconds (always fresh from EspoCRM)
- No memory usage
- Always up-to-date

## Monitoring

### Check which entities are cached:

```bash
# View cache statistics
curl http://localhost:3000/api/cache/stats

# View all cache keys
curl http://localhost:3000/api/cache/keys
```

### Server logs will show:

```
[Cache Warmer] Starting cache warm-up for: CProduct, CCollection, CBlog
[Cache HIT] espo:CProduct:all::
[Cache SKIP] espo:COrder:all:: (entity not cached)
```

## Best Practices

1. **Cache static content** - Products, collections, blogs that don't change often
2. **Don't cache transactional data** - Orders, carts, user accounts
3. **Set appropriate refresh intervals** - Balance freshness vs performance
4. **Monitor cache hit rates** - Use `/api/cache/stats` endpoint
5. **Clear cache after bulk updates** - Use `DELETE /api/cache/all` or restart server

## Troubleshooting

### Entity not caching?

Check your configuration:

```bash
# In your .env file
echo $CACHE_ENTITIES
echo $NO_CACHE_ENTITIES
```

Look for logs:

```
[Cache SKIP] espo:YourEntity:all:: (entity not cached)
```

### Stale data?

1. Reduce refresh interval: `CACHE_REFRESH_INTERVAL_HOURS=1`
2. Clear cache manually: `DELETE /api/cache/all`
3. Add entity to NO_CACHE list if it changes frequently

### Memory issues?

1. Reduce cached entities: Only cache what you need
2. Reduce max records: `ESPO_LIST_MAX_TOTAL=1000`
3. Increase refresh interval: `CACHE_REFRESH_INTERVAL_HOURS=48`

## Complete Example Configuration

```env
# All entities in your system
ESPO_ENTITIES=CProduct,CCollection,CBlog,COrder,CCart,CCustomerAccount,CLead

# Cache only static content (24-hour refresh)
CACHE_ENTITIES=CProduct,CCollection,CBlog
CACHE_REFRESH_INTERVAL_HOURS=24

# Never cache transactional data (always fresh)
NO_CACHE_ENTITIES=COrder,CCart,CCustomerAccount,CLead

# Cache limits
ESPO_LIST_MAX_TOTAL=5000
ESPO_LIST_PAGE_SIZE=200
```

This gives you:

- Fast product/collection/blog responses (10-50ms)
- Real-time order/cart/account data (always fresh)
- Automatic cache refresh every 24 hours
- Optimal memory usage
