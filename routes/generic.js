const express = require("express");
const { createEntityController } = require("../controller/genericController");

// Parse no-cache entities from environment
const noCacheEntities = String(process.env.NO_CACHE_ENTITIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Public caching for GET responses (Vercel CDN)
// Goal: cache on Vercel's edge, not the browser.
// - max-age=0 => browsers revalidate
// - s-maxage=300 => cache at CDN for 5 minutes
// - stale-while-revalidate=86400 => serve stale for up to 24h while refreshing
const publicCache = (entityName) => (req, res, next) => {
  // ✅ Don't let Vercel CDN cache these entities
  if (noCacheEntities.includes(entityName)) {
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Vercel-CDN-Cache-Control", "no-store");
    res.set("CDN-Cache-Control", "no-store");
    return next();
  }

  const TTL = 300;
  const SWR = 86400;

  // Only enable CDN caching in production
  if (process.env.NODE_ENV !== "production") return next();

  // Allow bypassing cache when needed: ?nocache=1
  if (req.query?.nocache === "1") {
    res.set("Cache-Control", "no-store");
    return next();
  }

  // Don’t cache personalized / authenticated requests
  // (Vercel won't cache these anyway, so skip setting headers)
  if (req.headers.authorization) return next();
  if (req.headers.cookie) return next();

  // Browser: don't store, but allow revalidate
  // CDN (shared cache): cache for TTL, serve stale while revalidating
  res.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=${SWR}`,
  );

  // Vercel edge cache (most reliable header for Vercel caching behavior)
  res.set(
    "Vercel-CDN-Cache-Control",
    `max-age=${TTL}, stale-while-revalidate=${SWR}`,
  );

  // Optional generic CDN header (harmless; useful on other CDNs)
  res.set("CDN-Cache-Control", `max-age=${TTL}, stale-while-revalidate=${SWR}`);

  return next();
};

// Generic route factory that creates routes for any entity
const createEntityRoutes = (entityName) => {
  const router = express.Router();
  const controller = createEntityController(entityName);

  // GET /:entity - Get all records
  router.get("/", publicCache(entityName), controller.getAllRecords);

  // GET /:entity/search/:searchValue - Search products by keywords or productTitle
  router.get(
    "/search/:searchValue",
    publicCache(entityName),
    controller.getBySearchProduct,
  );

  // GET /:entity/fieldname/:fieldName/:fieldValue - Get records filtered by field and value (MORE SPECIFIC - must come first)
  router.get(
    "/fieldname/:fieldName/:fieldValue",
    publicCache(entityName),
    controller.getRecordsByFieldValue,
  );

  // GET /:entity/fieldname/:fieldName - Get unique values for specified field (LESS SPECIFIC - comes after)
  router.get(
    "/fieldname/:fieldName",
    publicCache(entityName),
    controller.getUniqueFieldValues,
  );

  // GET /:entity/:id - Get single record by ID
  router.get("/:id", publicCache(entityName), controller.getRecordById);

  // POST /:entity - Create new record
  router.post("/", controller.createRecord);

  // PUT /:entity/:id - Update record by ID
  router.put("/:id", controller.updateRecord);

  // DELETE /:entity/:id - Delete record by ID
  router.delete("/:id", controller.deleteRecord);

  return router;
};

module.exports = { createEntityRoutes };
