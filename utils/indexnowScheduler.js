/**
 * IndexNow Scheduler - Automatically fetch URLs from sitemap.xml and submit to IndexNow
 */

const cron = require("node-cron");
const { submitIndexNow } = require("./indexnow");

/**
 * Parse XML sitemap and extract URLs
 * @param {string} xmlContent - Raw XML content from sitemap
 * @returns {Array} Array of URLs
 */
function parseSitemapUrls(xmlContent) {
  const urls = [];

  try {
    // Simple regex to extract <loc> tags from sitemap XML
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;

    while ((match = locRegex.exec(xmlContent)) !== null) {
      const url = match[1].trim();
      if (url && url.startsWith("http")) {
        urls.push(url);
      }
    }

    console.log(`[IndexNow Scheduler] Parsed ${urls.length} URLs from sitemap`);
    return urls;
  } catch (error) {
    console.error(
      "[IndexNow Scheduler] Error parsing sitemap XML:",
      error.message,
    );
    return [];
  }
}

/**
 * Fetch sitemap.xml and extract all URLs
 * @param {string} sitemapUrl - URL to sitemap.xml
 * @returns {Promise<Array>} Array of URLs
 */
async function fetchSitemapUrls(sitemapUrl) {
  try {
    console.log(`[IndexNow Scheduler] Fetching sitemap from: ${sitemapUrl}`);

    const response = await fetch(sitemapUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlContent = await response.text();
    const urls = parseSitemapUrls(xmlContent);

    console.log(
      `[IndexNow Scheduler] Successfully fetched ${urls.length} URLs from sitemap`,
    );
    return urls;
  } catch (error) {
    console.error(
      "[IndexNow Scheduler] Error fetching sitemap:",
      error.message,
    );
    return [];
  }
}

/**
 * Fetch URLs from sitemap and submit to IndexNow
 */
async function runScheduledIndexNow() {
  if (process.env.INDEXNOW_SCHEDULER_ENABLED !== "true") {
    console.log("[IndexNow Scheduler] Disabled - skipping");
    return;
  }

  const startTime = new Date();
  console.log(`[IndexNow Scheduler] Starting at ${startTime.toISOString()}`);

  try {
    // Get sitemap URL
    const sitemapUrl =
      process.env.INDEXNOW_SITEMAP_URL ||
      `https://${process.env.INDEXNOW_HOST}/sitemap.xml`;

    if (!sitemapUrl) {
      console.error("[IndexNow Scheduler] ❌ No sitemap URL configured");
      return;
    }

    // Fetch all URLs from sitemap
    const urls = await fetchSitemapUrls(sitemapUrl);

    if (urls.length === 0) {
      console.log("[IndexNow Scheduler] ⚠️ No URLs found in sitemap");
      return;
    }

    // Submit all URLs to IndexNow
    console.log(
      `[IndexNow Scheduler] Submitting ${urls.length} URLs to IndexNow...`,
    );

    const result = await submitIndexNow({
      endpoint: process.env.INDEXNOW_ENDPOINT,
      host: process.env.INDEXNOW_HOST,
      key: process.env.INDEXNOW_KEY,
      urls: urls,
    });

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    if (result.ok) {
      console.log(
        `[IndexNow Scheduler] ✅ Success! Submitted ${result.submitted} URLs in ${duration}s`,
      );
      console.log(
        `[IndexNow Scheduler] Results:`,
        result.results.map((r) => `Status ${r.status} (${r.batchSize} URLs)`),
      );

      // Log sample URLs for verification
      if (urls.length > 0) {
        console.log(`[IndexNow Scheduler] Sample URLs submitted:`);
        urls.slice(0, 5).forEach((url) => console.log(`  - ${url}`));
        if (urls.length > 5) {
          console.log(`  ... and ${urls.length - 5} more URLs`);
        }
      }
    } else {
      console.error(`[IndexNow Scheduler] ❌ Failed:`, result);
    }
  } catch (error) {
    console.error("[IndexNow Scheduler] ❌ Fatal error:", error.message);
  }
}

/**
 * Start the IndexNow scheduler
 */
function startIndexNowScheduler() {
  if (process.env.INDEXNOW_SCHEDULER_ENABLED !== "true") {
    console.log("[IndexNow Scheduler] Disabled in environment");
    return;
  }

  const schedule = process.env.INDEXNOW_SCHEDULE || "0 2 * * *"; // Default: 2 AM daily
  const sitemapUrl =
    process.env.INDEXNOW_SITEMAP_URL ||
    `https://${process.env.INDEXNOW_HOST}/sitemap.xml`;

  console.log(`[IndexNow Scheduler] Starting with schedule: ${schedule}`);
  console.log(`[IndexNow Scheduler] Sitemap URL: ${sitemapUrl}`);
  console.log(`[IndexNow Scheduler] Host: ${process.env.INDEXNOW_HOST}`);

  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.error(`[IndexNow Scheduler] ❌ Invalid cron schedule: ${schedule}`);
    return;
  }

  // Schedule the job
  const task = cron.schedule(schedule, runScheduledIndexNow, {
    scheduled: true,
    timezone: process.env.INDEXNOW_TIMEZONE || "UTC",
  });

  console.log("[IndexNow Scheduler] ✅ Scheduled successfully");

  // Optional: Run once on startup for testing
  if (process.env.INDEXNOW_RUN_ON_STARTUP === "true") {
    console.log("[IndexNow Scheduler] Running initial submission...");
    setTimeout(runScheduledIndexNow, 5000); // Wait 5 seconds after startup
  }

  return task;
}

/**
 * Manual trigger for testing
 */
async function triggerManualIndexNow() {
  console.log("[IndexNow Scheduler] Manual trigger requested");
  await runScheduledIndexNow();
}

/**
 * Test sitemap parsing (for debugging)
 */
async function testSitemapParsing() {
  const sitemapUrl =
    process.env.INDEXNOW_SITEMAP_URL ||
    `https://${process.env.INDEXNOW_HOST}/sitemap.xml`;

  console.log(`[IndexNow Test] Testing sitemap parsing for: ${sitemapUrl}`);

  const urls = await fetchSitemapUrls(sitemapUrl);

  console.log(`[IndexNow Test] Found ${urls.length} URLs:`);
  urls.slice(0, 10).forEach((url, index) => {
    console.log(`  ${index + 1}. ${url}`);
  });

  if (urls.length > 10) {
    console.log(`  ... and ${urls.length - 10} more URLs`);
  }

  return urls;
}

module.exports = {
  startIndexNowScheduler,
  triggerManualIndexNow,
  runScheduledIndexNow,
  testSitemapParsing,
};
