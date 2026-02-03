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

module.exports = {
  submitIndexNow,
};
