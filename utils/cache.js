const NodeCache = require("node-cache");

/**
 * Cache configuration:
 * - stdTTL: 24 hours (86400 seconds)
 * - checkperiod: Check for expired keys every 2 hours (7200 seconds)
 * - useClones: false for better performance (be careful with mutations)
 */
const cache = new NodeCache({
  stdTTL: 86400, // 24 hours in seconds
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
 * Get data from cache
 */
function getCache(key) {
  try {
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
function setCache(key, data, ttl = null) {
  try {
    if (ttl) {
      cache.set(key, data, ttl);
    } else {
      cache.set(key, data);
    }
    console.log(`[Cache SET] ${key} (TTL: ${ttl || "24h"})`);
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
};
