const NodeCache = require("node-cache");

/**
 * Cache configuration:
 * - stdTTL: 0 (no expiration by default, we'll set per-entity)
 * - checkperiod: Check for expired keys every 2 hours (7200 seconds)
 * - useClones: false for better performance (be careful with mutations)
 */
const cache = new NodeCache({
  stdTTL: 0, // No expiration by default
  checkperiod: 7200, // Check every 2 hours
  useClones: false, // Better performance, but don't mutate cached objects
  deleteOnExpire: true,
});

/**
 * Cache key generators for different entity types
 */
function getCacheKey(entityName, params = {}) {
  const base = `espo:${entityName}`;

  // For list queries
  if (params.type === "list") {
    const { page = 1, limit = 20, orderBy = "", order = "" } = params;
    return `${base}:list:p${page}:l${limit}:${orderBy}:${order}`;
  }

  // For single record by ID
  if (params.type === "single" && params.id) {
    return `${base}:single:${params.id}`;
  }

  // For field value queries
  if (params.type === "field" && params.fieldName && params.fieldValue) {
    return `${base}:field:${params.fieldName}:${params.fieldValue}`;
  }

  // For unique field values
  if (params.type === "unique" && params.fieldName) {
    return `${base}:unique:${params.fieldName}`;
  }

  // For search queries
  if (params.type === "search" && params.searchValue) {
    return `${base}:search:${params.searchValue}`;
  }

  // For all records (used in fetchAllRecords)
  if (params.type === "all") {
    const { orderBy = "", order = "" } = params;
    return `${base}:all:${orderBy}:${order}`;
  }

  return base;
}

/**
 * Check if an entity should use cache
 * Returns: 'timed' | 'short' | false
 * - 'timed': CACHE_ENTITIES (24-hour TTL)
 * - 'short': NO_CACHE_ENTITIES (5-second TTL for burst protection)
 * - false: Don't cache at all
 */
function shouldUseCache(entityName) {
  const cachedEntities = process.env.CACHE_ENTITIES
    ? process.env.CACHE_ENTITIES.split(",").map((e) => e.trim())
    : [];

  const noCacheEntities = process.env.NO_CACHE_ENTITIES
    ? process.env.NO_CACHE_ENTITIES.split(",").map((e) => e.trim())
    : [];

  // NO_CACHE_ENTITIES = Short cache (5 seconds) for burst protection
  // This prevents hammering EspoCRM with duplicate requests
  if (noCacheEntities.includes(entityName)) {
    return "short";
  }

  // CACHE_ENTITIES = Timed cache (24-hour TTL)
  if (cachedEntities.length > 0) {
    return cachedEntities.includes(entityName) ? "timed" : false;
  }

  // Default: timed cache for all entities
  return "timed";
}

/**
 * Get data from cache
 */
function getCache(key, entityName = null) {
  try {
    // Check if this entity should use cache
    const cacheType = entityName ? shouldUseCache(entityName) : "timed";
    if (cacheType === false) {
      console.log(`[Cache SKIP] ${key} (entity not cached)`);
      return null;
    }

    const data = cache.get(key);
    if (data !== undefined) {
      console.log(`[Cache HIT] ${key}`);
      return data;
    }
    console.log(`[Cache MISS] ${key}`);
    return null;
  } catch (error) {
    console.error(`[Cache Error] Failed to get ${key}:`, error.message);
    return null;
  }
}

/**
 * Set data in cache
 */
function setCache(key, data, ttl = null, entityName = null) {
  try {
    // Check if this entity should use cache
    const cacheType = entityName ? shouldUseCache(entityName) : "timed";
    if (cacheType === false) {
      console.log(`[Cache SKIP] ${key} (entity not cached)`);
      return false;
    }

    // Determine TTL based on cache type
    let finalTTL = ttl;
    if (!finalTTL) {
      if (cacheType === "short") {
        // Use configurable short TTL for NO_CACHE entities (default: 5 seconds)
        const shortTTL = parseInt(process.env.NO_CACHE_SHORT_TTL_SECONDS) || 5;
        finalTTL = shortTTL > 0 ? shortTTL : 0; // 0 means no cache at all
        if (finalTTL === 0) {
          console.log(`[Cache SKIP] ${key} (short TTL disabled)`);
          return false;
        }
      } else {
        finalTTL = 86400; // 24 hours for regular cache
      }
    }

    cache.set(key, data, finalTTL);

    const ttlLabel =
      finalTTL < 60 ? `${finalTTL}s` : `${Math.round(finalTTL / 3600)}h`;
    console.log(`[Cache SET] ${key} (TTL: ${ttlLabel})`);
    return true;
  } catch (error) {
    console.error(`[Cache Error] Failed to set ${key}:`, error.message);
    return false;
  }
}

/**
 * Delete specific cache key
 */
function deleteCache(key) {
  try {
    cache.del(key);
    console.log(`[Cache DELETE] ${key}`);
    return true;
  } catch (error) {
    console.error(`[Cache Error] Failed to delete ${key}:`, error.message);
    return false;
  }
}

/**
 * Delete all cache keys for a specific entity
 */
function deleteCacheByEntity(entityName) {
  try {
    const keys = cache.keys();
    const entityKeys = keys.filter((key) =>
      key.startsWith(`espo:${entityName}:`),
    );
    cache.del(entityKeys);
    console.log(
      `[Cache DELETE] Cleared ${entityKeys.length} keys for ${entityName}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[Cache Error] Failed to clear entity ${entityName}:`,
      error.message,
    );
    return false;
  }
}

/**
 * Clear all cache
 */
function clearAllCache() {
  try {
    cache.flushAll();
    console.log("[Cache FLUSH] All cache cleared");
    return true;
  } catch (error) {
    console.error("[Cache Error] Failed to flush cache:", error.message);
    return false;
  }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return cache.getStats();
}

/**
 * Get all cache keys
 */
function getCacheKeys() {
  return cache.keys();
}

/**
 * Get list of entities with timed cache (24-hour TTL)
 */
function getCachedEntities() {
  const cachedEntities = process.env.CACHE_ENTITIES
    ? process.env.CACHE_ENTITIES.split(",").map((e) => e.trim())
    : [];

  return cachedEntities;
}

/**
 * Get list of entities with permanent cache (never expires, fastest)
 */
function getNoCacheEntities() {
  const noCacheEntities = process.env.NO_CACHE_ENTITIES
    ? process.env.NO_CACHE_ENTITIES.split(",").map((e) => e.trim())
    : [];

  return noCacheEntities;
}

module.exports = {
  cache,
  getCacheKey,
  getCache,
  setCache,
  deleteCache,
  deleteCacheByEntity,
  clearAllCache,
  getCacheStats,
  getCacheKeys,
  shouldUseCache,
  getCachedEntities,
  getNoCacheEntities,
};
