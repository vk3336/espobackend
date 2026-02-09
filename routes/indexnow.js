const express = require("express");
const router = express.Router();
const { submitIndexNow: _submitIndexNow } = require("../utils/indexnow");
const {
  triggerManualIndexNow,
  testSitemapParsing,
} = require("../utils/indexnowScheduler");

/**
 * Health check for IndexNow configuration
 * GET /indexnow/health
 */
router.get("/health", (req, res) => {
  const sitemapUrl =
    process.env.INDEXNOW_SITEMAP_URL ||
    `https://${process.env.INDEXNOW_HOST}/sitemap.xml`;

  const config = {
    schedulerEnabled: process.env.INDEXNOW_SCHEDULER_ENABLED === "true",
    endpoint: process.env.INDEXNOW_ENDPOINT || "not configured",
    host: process.env.INDEXNOW_HOST || "not configured",
    keyConfigured: !!process.env.INDEXNOW_KEY,
    sitemapUrl: sitemapUrl,
    schedule: process.env.INDEXNOW_SCHEDULE || "0 2 * * *",
    timezone: process.env.INDEXNOW_TIMEZONE || "UTC",
  };

  const isValid =
    config.schedulerEnabled &&
    config.endpoint !== "not configured" &&
    config.host !== "not configured" &&
    config.keyConfigured &&
    config.sitemapUrl;

  res.json({
    ok: true,
    valid: isValid,
    config,
    message: isValid
      ? "IndexNow scheduler is properly configured"
      : "IndexNow scheduler configuration incomplete",
  });
});

/**
 * Get IndexNow key file content (for debugging)
 * GET /indexnow/key
 */
router.get("/key", (req, res) => {
  if (!process.env.INDEXNOW_KEY) {
    return res.status(404).json({
      ok: false,
      error: "IndexNow key not configured",
    });
  }

  // Return key for creating the key file on frontend
  res.json({
    ok: true,
    key: process.env.INDEXNOW_KEY,
    filename: `${process.env.INDEXNOW_KEY}.txt`,
    content: process.env.INDEXNOW_KEY,
    instructions: [
      `Create a file named '${process.env.INDEXNOW_KEY}.txt' in your frontend's public directory`,
      `The file content should be exactly: ${process.env.INDEXNOW_KEY}`,
      `The file should be accessible at: https://${process.env.INDEXNOW_HOST}/${process.env.INDEXNOW_KEY}.txt`,
    ],
  });
});

/**
 * Manual trigger for scheduled IndexNow (for testing)
 * POST /indexnow/trigger
 */
router.post("/trigger", async (req, res) => {
  try {
    if (process.env.INDEXNOW_SCHEDULER_ENABLED !== "true") {
      return res.status(200).json({
        ok: true,
        disabled: true,
        message: "IndexNow scheduler is disabled",
      });
    }

    // Optional: Protect this endpoint with a token
    const authToken =
      req.headers["x-indexnow-token"] || req.headers["authorization"];
    if (
      process.env.INDEXNOW_AUTH_TOKEN &&
      authToken !== process.env.INDEXNOW_AUTH_TOKEN
    ) {
      return res.status(403).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    console.log("[IndexNow API] Manual trigger requested");

    // Trigger the scheduler manually (don't await to avoid timeout)
    triggerManualIndexNow().catch((error) => {
      console.error("[IndexNow API] Manual trigger failed:", error.message);
    });

    res.json({
      ok: true,
      message: "IndexNow manual trigger started",
      note: "Check server logs for progress",
    });
  } catch (error) {
    console.error("[IndexNow API] Trigger error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Test sitemap parsing (for debugging)
 * GET /indexnow/test-sitemap
 */
router.get("/test-sitemap", async (req, res) => {
  try {
    if (process.env.INDEXNOW_SCHEDULER_ENABLED !== "true") {
      return res.status(200).json({
        ok: true,
        disabled: true,
        message: "IndexNow scheduler is disabled",
      });
    }

    console.log("[IndexNow API] Sitemap test requested");

    const urls = await testSitemapParsing();

    res.json({
      ok: true,
      sitemapUrl:
        process.env.INDEXNOW_SITEMAP_URL ||
        `https://${process.env.INDEXNOW_HOST}/sitemap.xml`,
      urlsFound: urls.length,
      sampleUrls: urls.slice(0, 10),
      message: `Found ${urls.length} URLs in sitemap`,
    });
  } catch (error) {
    console.error("[IndexNow API] Sitemap test error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;

module.exports = router;
