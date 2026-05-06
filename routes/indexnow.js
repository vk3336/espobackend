const express = require("express");
const router = express.Router();
const { requireAdminToken } = require("../middleware/requireAdminToken");
const { requireCronSecret } = require("../middleware/requireCronSecret");
const {
  triggerManualIndexNow,
  testSitemapParsing,
} = require("../utils/indexnowScheduler");

async function startIndexNowRun(res, source) {
  if (process.env.INDEXNOW_SCHEDULER_ENABLED !== "true") {
    return res.status(200).json({
      ok: true,
      disabled: true,
      message: "IndexNow scheduler is disabled",
    });
  }

  console.log(`[IndexNow API] ${source} trigger requested`);

  triggerManualIndexNow().catch((error) => {
    console.error(`[IndexNow API] ${source} trigger failed:`, error.message);
  });

  return res.json({
    ok: true,
    message: "IndexNow trigger started",
    source,
    note: "Check server logs for progress",
  });
}

/**
 * Health check for IndexNow configuration
 * GET /indexnow/health
 */
router.get("/health", (req, res) => {
  const frontendUrl = String(process.env.FRONTEND_URL || "").trim();
  const sitemapUrl = frontendUrl ? `${frontendUrl}/sitemap.xml` : null;

  const config = {
    schedulerEnabled: process.env.INDEXNOW_SCHEDULER_ENABLED === "true",
    endpoint: "https://api.indexnow.org/indexnow",
    host: frontendUrl ? frontendUrl.replace(/^https?:\/\//, "") : null,
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
router.get("/key", requireAdminToken, (req, res) => {
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
      `The file should be accessible at: ${process.env.FRONTEND_URL}/${process.env.INDEXNOW_KEY}.txt`,
    ],
  });
});

/**
 * Manual trigger for scheduled IndexNow (for testing)
 * POST /indexnow/trigger
 */
router.post("/trigger", requireAdminToken, async (req, res) => {
  try {
    return startIndexNowRun(res, "admin");
  } catch (error) {
    console.error("[IndexNow API] Trigger error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Cron trigger for Vercel Cron Jobs
 * GET /indexnow/cron
 */
router.get("/cron", requireCronSecret, async (req, res) => {
  try {
    return startIndexNowRun(res, "cron");
  } catch (error) {
    console.error("[IndexNow API] Cron trigger error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Test sitemap parsing (for debugging)
 * GET /indexnow/test-sitemap
 */
router.get("/test-sitemap", requireAdminToken, async (req, res) => {
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
      sitemapUrl: `${process.env.FRONTEND_URL}/sitemap.xml`,
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
