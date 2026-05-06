const express = require("express");
const {
  getDynamicSection,
  getAllDynamicSections,
} = require("../controller/genericController");

const router = express.Router();

// Public caching for GET responses (Vercel CDN)
const publicCache = (req, res, next) => {
  const TTL = 300;
  const SWR = 86400;

  // Only enable CDN caching in production
  if (process.env.NODE_ENV !== "production") return next();

  // Allow bypassing cache when needed: ?nocache=1
  if (req.query?.nocache === "1") {
    res.set("Cache-Control", "no-store");
    return next();
  }

  // Don't cache personalized / authenticated requests
  if (req.headers.authorization) return next();
  if (req.headers.cookie) return next();

  // Browser: don't store, but allow revalidate
  // CDN (shared cache): cache for TTL, serve stale while revalidating
  res.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=${SWR}`,
  );

  // Vercel edge cache
  res.set(
    "Vercel-CDN-Cache-Control",
    `max-age=${TTL}, stale-while-revalidate=${SWR}`,
  );

  // Optional generic CDN header
  res.set("CDN-Cache-Control", `max-age=${TTL}, stale-while-revalidate=${SWR}`);

  return next();
};

// GET /api/dynamicsection - Get all records where TopicPage.slug matches Product.merchTags
router.get("/", publicCache, getAllDynamicSections);

// GET /api/dynamicsection/:merchtag - Get records from TopicPage (slug) and Product (merchTags)
router.get("/:merchtag", publicCache, getDynamicSection);

module.exports = router;
