const { espoRequest } = require("../controller/espoClient");
const { getCacheKey, setCache } = require("./cache");

/**
 * Warm up cache by pre-loading specified entities
 * This runs on server startup to ensure fast first requests
 */
async function warmUpCache(entities) {
  const { getNoCacheEntities } = require("./cache");

  const noCacheEntities = getNoCacheEntities();

  // Warm up all entities except NO_CACHE_ENTITIES
  const entitiesToWarm = entities.filter((e) => !noCacheEntities.includes(e));

  if (entitiesToWarm.length === 0) {
    console.log("[Cache Warmer] No entities configured for caching");
    return { success: [], failed: [] };
  }

  console.log(
    `[Cache Warmer] Starting cache warm-up for: ${entitiesToWarm.join(", ")}`,
  );
  if (noCacheEntities.length > 0) {
    console.log(
      `[Cache Warmer] Skipping (no cache): ${noCacheEntities.join(", ")}`,
    );
  }

  const startTime = Date.now();

  const results = {
    success: [],
    failed: [],
  };

  for (const entityName of entitiesToWarm) {
    try {
      console.log(`[Cache Warmer] Loading ${entityName}...`);

      // Fetch all records for this entity
      const pageSize = Number(process.env.ESPO_LIST_PAGE_SIZE || 200);
      const maxTotal = Number(process.env.ESPO_LIST_MAX_TOTAL || 5000);

      let offset = 0;
      let all = [];
      let total = null;

      while (true) {
        const query = {
          maxSize: pageSize,
          offset,
        };

        const data = await espoRequest(`/${entityName}`, { query });
        const list = data?.list ?? [];
        const t = typeof data?.total === "number" ? data.total : null;

        if (total === null && t !== null) total = t;

        all = all.concat(list);
        offset += list.length;

        // Stop conditions
        if (list.length === 0) break;
        if (total !== null && offset >= total) break;
        if (all.length >= maxTotal) break;
        if (list.length < pageSize) break;
      }

      const result = {
        list: all,
        total: total !== null ? total : all.length,
      };

      // Store in cache
      const cacheKey = getCacheKey(entityName, {
        type: "all",
        orderBy: "",
        order: "",
      });
      setCache(cacheKey, result, null, entityName);

      // Also cache individual records
      for (const record of all) {
        if (record.id) {
          const recordCacheKey = getCacheKey(entityName, {
            type: "single",
            id: record.id,
          });
          setCache(recordCacheKey, record, null, entityName);
        }
      }

      results.success.push({
        entity: entityName,
        records: all.length,
      });

      console.log(
        `[Cache Warmer] ✓ ${entityName}: ${all.length} records cached`,
      );
    } catch (error) {
      console.error(`[Cache Warmer] ✗ ${entityName} failed:`, error.message);
      results.failed.push({
        entity: entityName,
        error: error.message,
      });
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Cache Warmer] Completed in ${duration}ms`);
  console.log(
    `[Cache Warmer] Success: ${results.success.length}, Failed: ${results.failed.length}`,
  );

  return results;
}

/**
 * Schedule periodic cache refresh (only for cached entities)
 */
function scheduleCacheRefresh(entities) {
  const { getNoCacheEntities } = require("./cache");

  const noCacheEntities = getNoCacheEntities();

  // Refresh all entities except NO_CACHE_ENTITIES
  const entitiesToRefresh = entities.filter(
    (e) => !noCacheEntities.includes(e),
  );

  if (entitiesToRefresh.length === 0) {
    console.log("[Cache Warmer] No cached entities to refresh");
    return;
  }

  const refreshInterval =
    Number(process.env.CACHE_REFRESH_INTERVAL_HOURS || 24) * 60 * 60 * 1000;

  console.log(
    `[Cache Warmer] Scheduling refresh every ${refreshInterval / 1000 / 60 / 60} hours`,
  );
  console.log(
    `[Cache Warmer] Entities to refresh: ${entitiesToRefresh.join(", ")}`,
  );

  setInterval(async () => {
    console.log("[Cache Warmer] Starting scheduled cache refresh...");
    await warmUpCache(entitiesToRefresh);
  }, refreshInterval);
}

module.exports = {
  warmUpCache,
  scheduleCacheRefresh,
};
