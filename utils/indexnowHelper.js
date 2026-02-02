/**
 * Helper functions to automatically trigger IndexNow submissions
 * when products/entities are created, updated, or deleted
 */

const { submitProductUrls, submitIndexNow } = require("./indexnow");

/**
 * Submit IndexNow notification when products are modified
 * @param {string[]} productIds - Array of product IDs or slugs
 * @param {string} action - Action performed (created, updated, deleted)
 * @param {Object} options - Additional options
 * @returns {Promise<void>}
 */
async function notifyProductChange(
  productIds,
  action = "updated",
  options = {},
) {
  if (process.env.INDEXNOW_ENABLED !== "true") {
    return;
  }

  try {
    // Convert product IDs to slugs if needed
    const slugs = Array.isArray(productIds) ? productIds : [productIds];

    console.log(
      `[IndexNow Helper] Notifying ${action} for ${slugs.length} products`,
    );

    const result = await submitProductUrls(slugs, action);

    if (result.ok && !result.disabled) {
      console.log(
        `[IndexNow Helper] Successfully submitted ${result.submitted} URLs`,
      );
    }
  } catch (error) {
    console.error(
      `[IndexNow Helper] Failed to notify product ${action}:`,
      error.message,
    );
  }
}

/**
 * Submit IndexNow notification for custom URLs
 * @param {string[]} urls - Array of full URLs to submit
 * @param {string} reason - Reason for submission (for logging)
 * @returns {Promise<void>}
 */
async function notifyUrlChange(urls, reason = "content updated") {
  if (process.env.INDEXNOW_ENABLED !== "true") {
    return;
  }

  try {
    const urlArray = Array.isArray(urls) ? urls : [urls];

    console.log(
      `[IndexNow Helper] Notifying URL changes: ${reason} (${urlArray.length} URLs)`,
    );

    const result = await submitIndexNow({
      endpoint: process.env.INDEXNOW_ENDPOINT,
      host: process.env.INDEXNOW_HOST,
      key: process.env.INDEXNOW_KEY,
      keyLocation: process.env.INDEXNOW_KEY_LOCATION,
      urls: urlArray,
    });

    if (result.ok && !result.disabled) {
      console.log(
        `[IndexNow Helper] Successfully submitted ${result.submitted} URLs`,
      );
    }
  } catch (error) {
    console.error(
      `[IndexNow Helper] Failed to notify URL changes:`,
      error.message,
    );
  }
}

/**
 * Middleware to automatically notify IndexNow after successful API operations
 * Add this to your routes that modify products
 */
function createIndexNowMiddleware(options = {}) {
  return async (req, res, next) => {
    // Store original res.json to intercept successful responses
    const originalJson = res.json;

    res.json = function (data) {
      // Only trigger IndexNow for successful operations
      if (
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        data &&
        data.success !== false
      ) {
        // Determine action based on HTTP method
        let action = "updated";
        if (req.method === "POST") action = "created";
        else if (req.method === "DELETE") action = "deleted";

        // Extract product identifier from response or request
        const productId =
          data.id || data.productId || req.params.id || req.body.id;

        if (productId) {
          // Don't await - fire and forget to avoid slowing down the response
          notifyProductChange([productId], action).catch((err) => {
            console.error(
              "[IndexNow Middleware] Background notification failed:",
              err.message,
            );
          });
        }
      }

      // Call original res.json
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Batch notify multiple product changes (useful for bulk operations)
 * @param {Array} changes - Array of {id, action} objects
 * @returns {Promise<void>}
 */
async function notifyBatchChanges(changes) {
  if (process.env.INDEXNOW_ENABLED !== "true" || !Array.isArray(changes)) {
    return;
  }

  try {
    // Group changes by action
    const grouped = changes.reduce((acc, change) => {
      const action = change.action || "updated";
      if (!acc[action]) acc[action] = [];
      acc[action].push(change.id);
      return acc;
    }, {});

    // Submit each group
    for (const [action, ids] of Object.entries(grouped)) {
      if (ids.length > 0) {
        await notifyProductChange(ids, action);
      }
    }
  } catch (error) {
    console.error(
      "[IndexNow Helper] Batch notification failed:",
      error.message,
    );
  }
}

module.exports = {
  notifyProductChange,
  notifyUrlChange,
  notifyBatchChanges,
  createIndexNowMiddleware,
};
