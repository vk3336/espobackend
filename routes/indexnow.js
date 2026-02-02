const express = require("express");
const router = express.Router();
const {
  submitIndexNow,
  submitProductUrls,
  submitMultiHostUrls,
  buildEntityUrls,
} = require("../utils/indexnow");

/**
 * Manual URL submission endpoint
 * POST /indexnow/submit
 * Body: { urls: ["https://example.com/page1", "https://example.com/page2"] }
 */
router.post("/submit", async (req, res) => {
  try {
    if (process.env.INDEXNOW_ENABLED !== "true") {
      return res.status(200).json({
        ok: true,
        disabled: true,
        message: "IndexNow is disabled",
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

    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "URLs array is required and must not be empty",
      });
    }

    const result = await submitIndexNow({
      endpoint: process.env.INDEXNOW_ENDPOINT,
      host: process.env.INDEXNOW_HOST,
      key: process.env.INDEXNOW_KEY,
      keyLocation: process.env.INDEXNOW_KEY_LOCATION,
      urls,
    });

    res.json(result);
  } catch (error) {
    console.error("[IndexNow] Submit error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Submit product URLs by slugs
 * POST /indexnow/products
 * Body: { slugs: ["product-1", "product-2"], action: "updated" }
 */
router.post("/products", async (req, res) => {
  try {
    if (process.env.INDEXNOW_ENABLED !== "true") {
      return res.status(200).json({
        ok: true,
        disabled: true,
        message: "IndexNow is disabled",
      });
    }

    const { slugs, action = "updated" } = req.body;

    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Product slugs array is required and must not be empty",
      });
    }

    const result = await submitProductUrls(slugs, action);
    res.json(result);
  } catch (error) {
    console.error("[IndexNow] Product submit error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Submit URLs to multiple hosts (multi-domain setup)
 * POST /indexnow/multi-host
 * Body: { urls: ["https://example.com/page1"] }
 */
router.post("/multi-host", async (req, res) => {
  try {
    if (process.env.INDEXNOW_ENABLED !== "true") {
      return res.status(200).json({
        ok: true,
        disabled: true,
        message: "IndexNow is disabled",
      });
    }

    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "URLs array is required and must not be empty",
      });
    }

    const results = await submitMultiHostUrls(urls);
    res.json({ ok: true, results });
  } catch (error) {
    console.error("[IndexNow] Multi-host submit error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Health check for IndexNow configuration
 * GET /indexnow/health
 */
router.get("/health", (req, res) => {
  const config = {
    enabled: process.env.INDEXNOW_ENABLED === "true",
    endpoint: process.env.INDEXNOW_ENDPOINT || "not configured",
    host: process.env.INDEXNOW_HOST || "not configured",
    keyConfigured: !!process.env.INDEXNOW_KEY,
    keyLocation: process.env.INDEXNOW_KEY_LOCATION || "default (root)",
    multiHost: !!process.env.INDEXNOW_HOSTS_JSON,
    authProtected: !!process.env.INDEXNOW_AUTH_TOKEN,
  };

  const isValid =
    config.enabled &&
    config.endpoint !== "not configured" &&
    config.host !== "not configured" &&
    config.keyConfigured;

  res.json({
    ok: true,
    valid: isValid,
    config,
    message: isValid
      ? "IndexNow is properly configured"
      : "IndexNow configuration incomplete",
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

module.exports = router;
