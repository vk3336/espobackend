// espoClient.js

// Simple rate limiter to prevent overwhelming the server
class RateLimiter {
  constructor(maxRequests = 10, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async waitForSlot() {
    const now = Date.now();
    // Remove old requests outside the window
    this.requests = this.requests.filter((time) => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.windowMs - (now - oldestRequest);
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.waitForSlot(); // Recursive call after waiting
      }
    }

    this.requests.push(now);
  }
}

// Create a rate limiter instance with configurable settings
const rateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1000,
);

// Retry mechanism with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      // Only retry on network errors or 5xx server errors
      if (error.status && error.status < 500) throw error;

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `Request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`,
        error.message,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function espoRequest(path, { method = "GET", body, query } = {}) {
  // Apply rate limiting
  await rateLimiter.waitForSlot();

  return retryWithBackoff(async () => {
    const base = process.env.ESPO_BASE_URL.replace(/\/$/, "");
    const prefix = process.env.ESPO_API_PREFIX || "/api/v1";

    const url = new URL(base + prefix + path);

    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    console.log(`[espoRequest] Making request to: ${url.toString()}`);
    console.log(`[espoRequest] Method: ${method}, Query:`, query);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.ESPO_API_KEY,
          Connection: "keep-alive", // Enable connection reuse
          "Accept-Encoding": "gzip, deflate, br", // Enable compression
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        // Enable HTTP/2 and connection pooling
        keepalive: true,
      });

      clearTimeout(timeoutId);

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        console.error(
          `[espoRequest] HTTP ${res.status} error from ${url.toString()}:`,
          data,
        );
        const err = new Error("EspoCRM request failed");
        err.status = res.status;
        err.data = data;
        err.url = url.toString();
        throw err;
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        const timeoutError = new Error("Request timeout");
        timeoutError.status = 408;
        throw timeoutError;
      }
      throw error;
    }
  });
}

module.exports = { espoRequest };
