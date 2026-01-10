const express = require("express");
const { createEntityController } = require("../controller/genericController");

// Public caching for GET responses (Vercel CDN)
// - s-maxage=300 => cache at the CDN for 5 minutes
// - stale-while-revalidate=86400 => serve stale for up to 24h while refreshing
const publicCache = (req, res, next) => {
  // Only enable CDN caching in production
  if (process.env.NODE_ENV !== "production") return next();

  // Allow bypassing cache when needed: ?nocache=1
  if (req.query?.nocache === "1") {
    res.set("Cache-Control", "no-store");
    return next();
  }

  // If you ever add auth later, don't cache user-specific responses
  if (req.headers.authorization) return next();

  res.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=86400"
  );
  return next();
};

// Generic route factory that creates routes for any entity
const createEntityRoutes = (entityName) => {
  const router = express.Router();
  const controller = createEntityController(entityName);

  // GET /:entity - Get all records
  router.get("/", publicCache, controller.getAllRecords);

  // GET /:entity/search/:searchValue
  router.get("/search/:searchValue", publicCache, controller.getBySearchProduct);

  // GET /:entity/fieldname/:fieldName/:fieldValue
  router.get(
    "/fieldname/:fieldName/:fieldValue",
    publicCache,
    controller.getRecordsByFieldValue
  );

  // GET /:entity/fieldname/:fieldName
  router.get("/fieldname/:fieldName", publicCache, controller.getUniqueFieldValues);

  // GET /:entity/:id
  router.get("/:id", publicCache, controller.getRecordById);

  // POST/PUT/DELETE (no caching)
  router.post("/", controller.createRecord);
  router.put("/:id", controller.updateRecord);
  router.delete("/:id", controller.deleteRecord);

  return router;
};

module.exports = { createEntityRoutes };
