/**
 * IndexNow utility for submitting URL changes to search engines
 * Supports bulk submissions up to 10,000 URLs per request
 */

/**
 * Split array into chunks of specified size
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Remove duplicates and filter out empty URLs
 */
function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/**
 * Submit URLs to IndexNow
 * @param {Object} options - Configuration options
 * @param {string} options.endpoint - IndexNow endpoint URL
 * @param {string} options.host - Host domain (without protocol)
 * @param {string} options.key - IndexNow key
 * @param {string[]} options.urls - Array of URLs to submit
 * @param {string} [options.keyLocation] - Optional custom key file location
 * @returns {Promise<Object>} Submission result
 */
async function submitIndexNow({ endpoint, host, key, keyLocation, urls }) {
  const urlList = uniq(urls);

  if (!endpoint || !host || !key) {
    throw new Error(
      "IndexNow missing required parameters: endpoint, host, or key",
    );
  }

  if (urlList.length === 0) {
    return {
      ok: true,
      submitted: 0,
      results: [],
      message: "No URLs to submit",
    };
  }

  console.log(`[IndexNow] Submitting ${urlList.length} URLs to ${endpoint}`);

  // IndexNow allows up to 10,000 URLs per POST request
  const batches = chunk(urlList, 10000);
  const results = [];

  for (const batch of batches) {
    const body = {
      host,
      key,
      urlList: batch,
      ...(keyLocation ? { keyLocation } : {}),
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "IndexNow-NodeJS-Client/1.0",
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text().catch(() => "");

      results.push({
        status: response.status,
        text: responseText,
        batchSize: batch.length,
      });

      console.log(
        `[IndexNow] Batch submitted: ${response.status} - ${batch.length} URLs`,
      );

      // Handle rate limiting
      if (response.status === 429) {
        console.warn(
          "[IndexNow] Rate limited, waiting 30 seconds before next batch",
        );
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }

      // Handle other errors
      if (!response.ok && response.status !== 429) {
        console.error(`[IndexNow] Error ${response.status}: ${responseText}`);
      }
    } catch (error) {
      console.error("[IndexNow] Request failed:", error.message);
      results.push({
        status: 0,
        text: error.message,
        batchSize: batch.length,
        error: true,
      });
    }
  }

  return {
    ok: true,
    submitted: urlList.length,
    results,
    batches: batches.length,
  };
}

/**
 * Build URLs for product/entity changes
 * @param {string} baseUrl - Frontend base URL (e.g., "https://www.example.com")
 * @param {string[]} slugs - Array of product slugs or entity identifiers
 * @param {string} [pathPrefix] - Optional path prefix (e.g., "/products")
 * @returns {string[]} Array of full URLs
 */
function buildEntityUrls(baseUrl, slugs, pathPrefix = "") {
  if (!baseUrl || !Array.isArray(slugs)) {
    return [];
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  const cleanPrefix = pathPrefix.startsWith("/")
    ? pathPrefix
    : `/${pathPrefix}`;

  return slugs
    .filter(Boolean)
    .map((slug) => `${cleanBaseUrl}${cleanPrefix}/${slug}`);
}

/**
 * Submit product URLs to IndexNow
 * @param {string[]} productSlugs - Array of product slugs
 * @param {string} [action] - Action type for logging (created, updated, deleted)
 * @returns {Promise<Object>} Submission result
 */
async function submitProductUrls(productSlugs, action = "updated") {
  if (process.env.INDEXNOW_ENABLED !== "true") {
    return { ok: true, disabled: true, message: "IndexNow is disabled" };
  }

  const frontendUrl =
    process.env.FRONTEND_URL || `https://${process.env.INDEXNOW_HOST}`;
  const urls = buildEntityUrls(frontendUrl, productSlugs, "/products");

  if (urls.length === 0) {
    return {
      ok: true,
      submitted: 0,
      message: "No valid product URLs to submit",
    };
  }

  console.log(`[IndexNow] Submitting ${urls.length} product URLs (${action})`);

  return await submitIndexNow({
    endpoint: process.env.INDEXNOW_ENDPOINT,
    host: process.env.INDEXNOW_HOST,
    key: process.env.INDEXNOW_KEY,
    keyLocation: process.env.INDEXNOW_KEY_LOCATION,
    urls,
  });
}

/**
 * Submit multiple host URLs (for multi-domain setups)
 * @param {string[]} urls - Array of URLs to submit
 * @returns {Promise<Object[]>} Array of submission results for each host
 */
async function submitMultiHostUrls(urls) {
  if (process.env.INDEXNOW_ENABLED !== "true") {
    return [{ ok: true, disabled: true, message: "IndexNow is disabled" }];
  }

  const hostsJson = process.env.INDEXNOW_HOSTS_JSON;
  const hosts = hostsJson ? JSON.parse(hostsJson) : [process.env.INDEXNOW_HOST];

  const results = [];

  for (const host of hosts) {
    const result = await submitIndexNow({
      endpoint: process.env.INDEXNOW_ENDPOINT,
      host,
      key: process.env.INDEXNOW_KEY,
      keyLocation: process.env.INDEXNOW_KEY_LOCATION,
      urls,
    });

    results.push({ host, ...result });
  }

  return results;
}

module.exports = {
  submitIndexNow,
  buildEntityUrls,
  submitProductUrls,
  submitMultiHostUrls,
};
