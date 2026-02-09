# Cache Setup Guide

## Overview

Your EspoCRM API now includes **node-cache** for storing data in memory for 24 hours. This dramatically improves response times by reducing API calls to your EspoCRM server.

## How It Works

### 1. **Automatic Cache Warming**

- On server startup, all entities are automatically loaded into cache
- Individual records are also cached for faster single-record lookups
- Cache is automatically refreshed every 24 hours

### 2. **Smart Cache Invalidation**

- When you CREATE, UPDATE, or DELETE a record, the cache for that entity is automatically cleared
- Fresh data is fetched on the next request and cached again

### 3. **Cache Keys**

The system uses intelligent cache keys:

- `espo:CProduct:all::` - All products
- `espo:CProduct:single:123` - Single product by ID
- `espo:CProduct:field:category:Fabric` - Products filtered by field
- `espo:CProduct:search:cotton` - Search results

## Configuration

Add these to your `.env` file:

```env
# Cache refresh interval in hours (default: 24)
CACHE_REFRESH_INTERVAL_HOURS=24

# Maximum records to fetch per entity (default: 5000)
ESPO_LIST_MAX_TOTAL=5000

# Page size for fetching records (default: 200)
ESPO_LIST_PAGE_SIZE=200
```

## Cache Management API

### Get Cache Statistics

```bash
GET /api/cache/stats
```

Response:

```json
{
  "success": true,
  "stats": {
    "keys": 150,
    "hits": 1250,
    "misses": 45,
    "ksize": 150,
    "vsize": 2500000
  },
  "totalKeys": 150,
  "sampleKeys": ["espo:CProduct:all::", "espo:CCollection:all::"]
}
```

### Get All Cache Keys

```bash
GET /api/cache/keys
```

### Clear All Cache

```bash
DELETE /api/cache/all
```

### Clear Cache for Specific Entity

```bash
DELETE /api/cache/entity/CProduct
```

### Delete Specific Cache Key

```bash
DELETE /api/cache/key
Content-Type: application/json

{
  "key": "espo:CProduct:all::"
}
```

## Performance Benefits

### Before Cache:

- First request: ~2-5 seconds (fetching from EspoCRM)
- Subsequent requests: ~2-5 seconds (still fetching from EspoCRM)

### After Cache:

- First request: ~2-5 seconds (fetching from EspoCRM + caching)
- Subsequent requests: ~10-50ms (from memory cache)

**That's 50-500x faster!** 🚀

## Cache Lifecycle

```
Server Start
    ↓
Warm Up Cache (load all entities)
    ↓
Serve Requests (from cache)
    ↓
After 24 hours → Auto Refresh
    ↓
Continue Serving (from fresh cache)
```

## Monitoring Cache

### Check if cache is working:

```bash
# First request (cache miss)
curl http://localhost:3000/api/product

# Check logs - you should see:
# [Cache MISS] espo:CProduct:all::
# [Cache SET] espo:CProduct:all:: (TTL: 24h)

# Second request (cache hit)
curl http://localhost:3000/api/product

# Check logs - you should see:
# [Cache HIT] espo:CProduct:all::
```

### View cache statistics:

```bash
curl http://localhost:3000/api/cache/stats
```

## Important Notes

### For Development:

- Cache is warmed up on server start
- You can manually clear cache using the API endpoints
- Restart server to reload all data

### For Production (Vercel):

- Cache is warmed up on cold start
- Serverless functions may have multiple instances, each with its own cache
- Consider using Redis for shared cache across instances (future enhancement)

### Cache Invalidation:

- **Automatic**: When you create/update/delete via this API
- **Manual**: Use the cache management endpoints
- **Automatic Refresh**: Every 24 hours

## Troubleshooting

### Cache not working?

1. Check if node-cache is installed: `npm list node-cache`
2. Check server logs for cache messages
3. Verify cache stats: `GET /api/cache/stats`

### Stale data?

1. Clear cache manually: `DELETE /api/cache/all`
2. Or clear specific entity: `DELETE /api/cache/entity/CProduct`
3. Or restart server

### Memory issues?

1. Reduce `ESPO_LIST_MAX_TOTAL` in .env
2. Reduce `CACHE_REFRESH_INTERVAL_HOURS` to clear cache more frequently
3. Monitor memory usage: `GET /health`

## Next Steps

For production environments with multiple server instances, consider:

- **Redis Cache**: Shared cache across all instances
- **Cache Clustering**: Distributed cache for high availability
- **Selective Caching**: Cache only frequently accessed entities

Let me know if you need help implementing any of these!
