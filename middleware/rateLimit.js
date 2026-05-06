function cleanStr(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getClientKey(req) {
  const cfIp = cleanStr(req?.headers?.["cf-connecting-ip"]);
  if (cfIp) return cfIp;

  const realIp = cleanStr(req?.headers?.["x-real-ip"]);
  if (realIp) return realIp;

  const forwardedFor = cleanStr(req?.headers?.["x-forwarded-for"]);
  if (forwardedFor) {
    const first = cleanStr(forwardedFor.split(",")[0]);
    if (first) return first;
  }

  const reqIp = cleanStr(req?.ip);
  if (reqIp) return reqIp;

  const remoteAddress = cleanStr(req?.connection?.remoteAddress);
  return remoteAddress || "anonymous";
}

function pruneExpiredEntries(store, now) {
  for (const [key, entry] of store.entries()) {
    if (!entry || entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

function createRateLimit({
  windowMs = 15 * 60 * 1000,
  limit = 20,
  keyPrefix = "default",
  message = "Too many requests. Please try again later.",
} = {}) {
  const windowSizeMs = toPositiveInteger(windowMs, 15 * 60 * 1000);
  const maxRequests = toPositiveInteger(limit, 20);
  const store = new Map();
  let requestCounter = 0;

  return (req, res, next) => {
    const now = Date.now();
    const clientKey = getClientKey(req);
    const storeKey = `${keyPrefix}:${clientKey}`;

    requestCounter += 1;
    if (requestCounter % 500 === 0) {
      pruneExpiredEntries(store, now);
    }

    let entry = store.get(storeKey);
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowSizeMs,
      };
    }

    entry.count += 1;
    store.set(storeKey, entry);

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - now) / 1000),
    );

    res.set("X-RateLimit-Limit", String(maxRequests));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(resetSeconds));

    if (entry.count > maxRequests) {
      res.set("Retry-After", String(resetSeconds));
      return res.status(429).json({
        success: false,
        error: message,
      });
    }

    return next();
  };
}

module.exports = { createRateLimit };
