const express = require("express");
const {
  getCacheStats,
  getCacheKeys,
  clearAllCache,
  deleteCacheByEntity,
  deleteCache,
} = require("../utils/cache");

const router = express.Router();

/**
 * GET /cache/stats
 * Get cache statistics
 */
router.get("/stats", (req, res) => {
  try {
    const stats = getCacheStats();
    const keys = getCacheKeys();

    res.json({
      success: true,
      stats: {
        keys: stats.keys,
        hits: stats.hits,
        misses: stats.misses,
        ksize: stats.ksize,
        vsize: stats.vsize,
      },
      totalKeys: keys.length,
      sampleKeys: keys.slice(0, 10), // Show first 10 keys
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /cache/keys
 * Get all cache keys
 */
router.get("/keys", (req, res) => {
  try {
    const keys = getCacheKeys();

    res.json({
      success: true,
      total: keys.length,
      keys: keys,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /cache/all
 * Clear all cache
 */
router.delete("/all", (req, res) => {
  try {
    clearAllCache();

    res.json({
      success: true,
      message: "All cache cleared successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /cache/entity/:entityName
 * Clear cache for specific entity
 */
router.delete("/entity/:entityName", (req, res) => {
  try {
    const { entityName } = req.params;
    deleteCacheByEntity(entityName);

    res.json({
      success: true,
      message: `Cache cleared for entity: ${entityName}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /cache/key
 * Delete specific cache key
 * Body: { key: "espo:CProduct:all::" }
 */
router.delete("/key", (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        error: "Cache key is required in request body",
      });
    }

    deleteCache(key);

    res.json({
      success: true,
      message: `Cache key deleted: ${key}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
