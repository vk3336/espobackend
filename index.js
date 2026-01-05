require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createEntityRoutes } = require("./routes/generic");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - support multiple origins
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"]; // fallback to localhost:3000

// Middleware
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

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
