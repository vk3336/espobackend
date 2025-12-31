require("dotenv").config();
const express = require("express");
const cors = require("cors");
const productsRouter = require("./routes/products");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dynamic API base names setup
const apiBaseNames = process.env.API_BASE_NAMES
  ? process.env.API_BASE_NAMES.split(",").map((name) => name.trim())
  : ["api"]; // fallback to 'api' if not defined

// Register routes for each API base name
apiBaseNames.forEach((baseName) => {
  app.use(`/${baseName}/product`, productsRouter);
});

// Basic health check route
app.get("/", (req, res) => {
  res.json({
    message: "EspoCRM API Server is running!",
    availableRoutes: apiBaseNames.map((name) => `/${name}/product`),
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
  console.log(`Available API routes:`);
  apiBaseNames.forEach((name) => {
    console.log(`  - /${name}/product`);
  });
});
