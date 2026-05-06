// Only load .env locally (Vercel provides env vars without .env)
if (process.env.NODE_ENV !== "production") {
  const dotenv = require("dotenv");
  const dotenvExpand = require("dotenv-expand");
  dotenvExpand.expand(dotenv.config());
}

const express = require("express");
//const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const { createEntityRoutes } = require("./routes/generic");
const chatRoutes = require("./routes/chat");
const adminChatRoutes = require("./routes/adminChat");
const indexnowRoutes = require("./routes/indexnow");
const cacheRoutes = require("./routes/cache");
const authRoutes = require("./routes/auth");
const dynamicSectionRoutes = require("./routes/dynamicSection");
const { requireAdminToken } = require("./middleware/requireAdminToken");
const { startIndexNowScheduler } = require("./utils/indexnowScheduler");
const { warmUpCache, scheduleCacheRefresh } = require("./utils/cacheWarmer");

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (HSTS, Referrer-Policy, X-Frame-Options, etc.)
app.use(helmet({ contentSecurityPolicy: false }));

// // Serve static assets explicitly because Vercel rewrites all requests to index.js.
// app.use(
//   express.static(path.join(__dirname, "public"), {
//     maxAge: "30d",
//     immutable: true,
//   }),
// );

/**
 * IMPORTANT for caching:
 * Disable ETag so browsers don't keep forcing 304 revalidations for big JSON.
 * We want Vercel CDN caching to do the heavy lifting.
 */
app.set("etag", false);

// CORS configuration - support multiple origins + wildcard "localhost" entry
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:3000"];

const allowAllLocalhost = corsOrigins.includes("localhost");

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowAllLocalhost && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      if (corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} - ${
        res.statusCode
      } (${duration}ms)`,
    );
  });

  next();
});

// Dynamic API base names setup
const apiBaseNames = ["api"];

function parseCsvEnvList(name, fallback = []) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [...fallback];

  const seen = new Set();
  const values = [];

  raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      values.push(value);
    });

  return values;
}

function mergeEntityLists(...lists) {
  const seen = new Set();
  const values = [];

  for (const list of lists) {
    for (const value of list) {
      const key = String(value).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
  }

  return values;
}

function isServerlessRuntime() {
  return !!String(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      "",
  ).trim();
}

function shouldRunStartupJobs(mode) {
  const serverlessRuntime = isServerlessRuntime();
  const allowServerlessJobs =
    process.env.ALLOW_SERVERLESS_STARTUP_JOBS === "true";

  if (serverlessRuntime && !allowServerlessJobs) {
    return false;
  }

  if (mode === "local") {
    return process.env.RUN_STARTUP_JOBS !== "false";
  }

  return process.env.RUN_STARTUP_JOBS === "true";
}

// Support separate public/private entity routing while keeping ESPO_ENTITIES as a fallback.
const legacyEntities = parseCsvEnvList("ESPO_ENTITIES");
const configuredPrivateEntities = parseCsvEnvList("PRIVATE_ESPO_ENTITIES");
const privateEntityNames = new Set(
  configuredPrivateEntities.map((entity) => entity.toLowerCase()),
);
const publicEntities = parseCsvEnvList(
  "PUBLIC_ESPO_ENTITIES",
  legacyEntities.length ? legacyEntities : ["CProduct"],
).filter((entity) => !privateEntityNames.has(entity.toLowerCase()));
const privateEntities = configuredPrivateEntities.filter(
  (entity) =>
    !publicEntities.some(
      (publicEntity) => publicEntity.toLowerCase() === entity.toLowerCase(),
    ),
);
const allConfiguredEntities = mergeEntityLists(publicEntities, privateEntities);

// Register routes for each API base name and entity combination
apiBaseNames.forEach((baseName) => {
  // Register generic routes for public entities
  publicEntities.forEach((entity) => {
    const entityRoute = entity.toLowerCase().replace(/^c/, ""); // Remove 'C' prefix and lowercase
    app.use(`/${baseName}/${entityRoute}`, createEntityRoutes(entity));
  });

  // Register admin-only entity routes
  privateEntities.forEach((entity) => {
    const entityRoute = entity.toLowerCase().replace(/^c/, "");
    app.use(
      `/${baseName}/${entityRoute}`,
      requireAdminToken,
      createEntityRoutes(entity),
    );
  });

  // Chat assistant endpoint(s)
  app.use(`/${baseName}/chat`, chatRoutes());
  // Admin audit chat
  app.use(`/${baseName}/admin-chat`, requireAdminToken, adminChatRoutes());

  // Auth endpoints (OTP)
  app.use(`/${baseName}/auth`, authRoutes);

  // Dynamic section endpoint
  app.use(`/${baseName}/dynamicsection`, dynamicSectionRoutes);

  // IndexNow endpoints
  app.use(`/${baseName}/indexnow`, indexnowRoutes);

  // Cache management endpoints
  app.use(`/${baseName}/cache`, requireAdminToken, cacheRoutes);
});

// Basic health check route
app.get("/", (req, res) => {
  const availableRoutes = [];

  apiBaseNames.forEach((baseName) => {
    // Add entity routes
    publicEntities.forEach((entity) => {
      const entityRoute = entity.toLowerCase().replace(/^c/, "");
      availableRoutes.push(`/${baseName}/${entityRoute}`);
    });

    // Add chat routes
    availableRoutes.push(`/${baseName}/chat/health`);
    availableRoutes.push(`/${baseName}/chat/message`);
  });

  res.json({
    message: "EspoCRM API Server is running!",
    entities: publicEntities,
    availableRoutes: availableRoutes,
    mode: "public-read-admin-write",
    apiStructure: {
      "GET /api/dynamicsection": "To get all the dynamic section value",
      "GET /api/dynamicsection/:merchtag value":
        "To get all the dynamic section value as dynamic",
      "GET /:base/:entity": "Get all records",
      "GET /:base/:entity/:id": "Get record by ID",
      "POST /:base/:entity": "Create record (admin token required)",
      "PUT /:base/:entity/:id": "Update record (admin token required)",
      "DELETE /:base/:entity/:id": "Delete record (admin token required)",
      "GET /:base/:entity/fieldname/:fieldName": "Get unique field values",
      "GET /:base/:entity/fieldname/:fieldName/:fieldValue":
        "Get records by field value",
      "GET /:entity/search/:searchValue":
        "Search products by keywords or productTitle",
    },
    authEndpoints: {
      "POST /:base/auth/register":
        "Register new account (email, firstName, lastName, phoneNumber)",
      "POST /:base/auth/login": "Login with existing account (email)",
      "POST /:base/auth/verify-otp": "Verify OTP code (email, otp)",
      "GET /:base/auth/health": "Auth service health check ok",
    },
  });
});

// Health check endpoint with more detailed information
app.get("/health", (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  const { getCacheStats } = require("./utils/cache");
  const cacheStats = getCacheStats();

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
    },
    cache: {
      enabled: true,
      keys: cacheStats.keys,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate:
        cacheStats.hits + cacheStats.misses > 0
          ? `${Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)}%`
          : "0%",
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      espoBaseUrl: process.env.ESPO_BASE_URL ? "configured" : "missing",
      espoApiKey: process.env.ESPO_API_KEY ? "configured" : "missing",
    },
    rateLimiting: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1000,
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
      authWindowMs:
        parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 20,
      chatWindowMs:
        parseInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
      chatMax: parseInt(process.env.CHAT_RATE_LIMIT_MAX) || 30,
    },
  });
});

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error(
    `[${new Date().toISOString()}] Error on ${req.method} ${req.url}:`,
    {
      message: err.message,
      status: err.status,
      stack: err.stack,
      data: err.data,
    },
  );

  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV !== "production";

  res.status(err.status || 500).json({
    success: false,
    error: isDevelopment ? err.message : "Something went wrong!",
    ...(isDevelopment && { details: err.data }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// For serverless deployment (Vercel, Netlify, etc.)
module.exports = app;

// For local development only
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
    console.log(`EspoCRM Base URL: ${process.env.ESPO_BASE_URL}`);
    console.log(`Public Entities: ${publicEntities.join(", ")}`);
    if (privateEntities.length > 0) {
      console.log(`Private Entities: ${privateEntities.join(", ")}`);
    }
    console.log(`Available API routes:`);

    apiBaseNames.forEach((baseName) => {
      publicEntities.forEach((entity) => {
        const entityRoute = entity.toLowerCase().replace(/^c/, "");
        console.log(`  - /${baseName}/${entityRoute} (${entity})`);
      });

      privateEntities.forEach((entity) => {
        const entityRoute = entity.toLowerCase().replace(/^c/, "");
        console.log(`  - /${baseName}/${entityRoute} (${entity}, admin only)`);
      });
    });

    const RUN_STARTUP_JOBS = shouldRunStartupJobs("local");

    if (RUN_STARTUP_JOBS) {
      // Start IndexNow scheduler
      startIndexNowScheduler();

      // Warm up cache with all entities (background)
      console.log("\n[Startup] Warming up cache (background)...");
      setImmediate(() => {
        warmUpCache(allConfiguredEntities)
          .then(() => {
            console.log("[Startup] Cache warmed up successfully");
            // Schedule automatic cache refresh every 24 hours
            scheduleCacheRefresh(allConfiguredEntities);
          })
          .catch((error) => {
            console.error("[Startup] Cache warm-up failed:", error.message);
          });
      });
    } else {
      if (isServerlessRuntime()) {
        console.log(
          "\n[Startup] Skipping background jobs on serverless runtime",
        );
      } else {
        console.log(
          "\n[Startup] Skipping background jobs (RUN_STARTUP_JOBS=false)",
        );
      }
    }

    console.log("\n[Startup] Server ready!");
  });
}

// Start background jobs in production when explicitly enabled and allowed
if (process.env.NODE_ENV === "production") {
  const RUN_STARTUP_JOBS = shouldRunStartupJobs("production");

  if (RUN_STARTUP_JOBS) {
    console.log(
      "[Startup] Running background jobs (schedulers + cache warmer)",
    );

    // Start IndexNow scheduler
    startIndexNowScheduler();

    // Warm up cache in background (non-blocking)
    console.log("[Startup] Warming up cache (background)...");
    setImmediate(() => {
      warmUpCache(allConfiguredEntities)
        .then(() => {
          console.log("[Production] Cache warmed up successfully");
          scheduleCacheRefresh(allConfiguredEntities);
        })
        .catch((error) => {
          console.error("[Production] Cache warm-up failed:", error.message);
        });
    });
  } else {
    if (isServerlessRuntime() && process.env.RUN_STARTUP_JOBS === "true") {
      console.log(
        "[Startup] Skipping background jobs on serverless runtime (set ALLOW_SERVERLESS_STARTUP_JOBS=true to override)",
      );
    } else {
      console.log(
        "[Startup] Skipping background jobs (RUN_STARTUP_JOBS=false)",
      );
    }
    console.log("[Startup] Cache will populate on-demand as requests come in");
  }
}
