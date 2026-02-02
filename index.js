// Only load .env locally (Vercel provides env vars without .env)
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const { createEntityRoutes } = require("./routes/generic");
const chatRoutes = require("./routes/chat");
const adminChatRoutes = require("./routes/adminChat");
const indexnowRoutes = require("./routes/indexnow");

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * IMPORTANT for caching:
 * Disable ETag so browsers don't keep forcing 304 revalidations for big JSON.
 * We want Vercel CDN caching to do the heavy lifting.
 */
app.set("etag", false);

// CORS configuration - support multiple origins
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"]; // fallback to localhost:3000

// Middleware
app.use(
  cors({
    origin: corsOrigins,
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
const apiBaseNames = process.env.API_BASE_NAMES
  ? process.env.API_BASE_NAMES.split(",").map((name) => name.trim())
  : ["api"]; // fallback to 'api' if not defined

// Get entities from environment
const entities = process.env.ESPO_ENTITIES
  ? process.env.ESPO_ENTITIES.split(",").map((name) => name.trim())
  : ["CProduct"]; // fallback to CProduct if not defined

// Register routes for each API base name and entity combination
apiBaseNames.forEach((baseName) => {
  // Register generic routes for all entities
  entities.forEach((entity) => {
    const entityRoute = entity.toLowerCase().replace(/^c/, ""); // Remove 'C' prefix and lowercase
    app.use(`/${baseName}/${entityRoute}`, createEntityRoutes(entity));
  });

  // Chat assistant endpoint(s)
  app.use(`/${baseName}/chat`, chatRoutes());
  // Admin audit chat
  app.use(`/${baseName}/admin-chat`, adminChatRoutes());

  // IndexNow endpoints
  app.use(`/${baseName}/indexnow`, indexnowRoutes);
});

// Basic health check route
app.get("/", (req, res) => {
  const availableRoutes = [];

  apiBaseNames.forEach((baseName) => {
    // Add entity routes
    entities.forEach((entity) => {
      const entityRoute = entity.toLowerCase().replace(/^c/, "");
      availableRoutes.push(`/${baseName}/${entityRoute}`);
    });

    // Add chat routes
    availableRoutes.push(`/${baseName}/chat/health`);
    availableRoutes.push(`/${baseName}/chat/message`);
  });

  res.json({
    message: "EspoCRM API Server is running!",
    entities: entities,
    availableRoutes: availableRoutes,
    apiStructure: {
      "GET /:base/:entity": "Get all records",
      "GET /:base/:entity/:id": "Get record by ID",
      "POST /:base/:entity": "Create new record",
      "PUT /:base/:entity/:id": "Update record",
      "DELETE /:base/:entity/:id": "Delete record",
      "GET /:base/:entity/fieldname/:fieldName": "Get unique field values",
      "GET /:base/:entity/fieldname/:fieldName/:fieldValue":
        "Get records by field value",
      "GET /:entity/search/:searchValue":
        "Search products by keywords or productTitle",
    },
  });
});

// Health check endpoint with more detailed information
app.get("/health", (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
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
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
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
  app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
    console.log(`EspoCRM Base URL: ${process.env.ESPO_BASE_URL}`);
    console.log(`Configured Entities: ${entities.join(", ")}`);
    console.log(`Available API routes:`);

    apiBaseNames.forEach((baseName) => {
      entities.forEach((entity) => {
        const entityRoute = entity.toLowerCase().replace(/^c/, "");
        console.log(`  - /${baseName}/${entityRoute} (${entity})`);
      });
    });
  });
}
