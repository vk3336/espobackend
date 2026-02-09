#!/usr/bin/env node

/**
 * Build Script for EspoCRM API
 * Validates the project is ready for deployment
 */

const fs = require("fs");
const path = require("path");

console.log("🔨 Building EspoCRM API...\n");

const errors = [];
const warnings = [];
const checks = [];

// Color codes for terminal
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkPass(message) {
  checks.push({ status: "pass", message });
  log(`✅ ${message}`, "green");
}

function checkWarn(message) {
  warnings.push(message);
  checks.push({ status: "warn", message });
  log(`⚠️  ${message}`, "yellow");
}

function checkFail(message) {
  errors.push(message);
  checks.push({ status: "fail", message });
  log(`❌ ${message}`, "red");
}

// ============================================
// 1. Check Required Files
// ============================================
log("\n📁 Checking Required Files...", "cyan");

const requiredFiles = [
  "index.js",
  "package.json",
  ".env.example",
  "controller/espoClient.js",
  "controller/genericController.js",
  "utils/cache.js",
  "utils/cacheWarmer.js",
  "routes/cache.js",
];

requiredFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    checkPass(`Found: ${file}`);
  } else {
    checkFail(`Missing required file: ${file}`);
  }
});

// ============================================
// 2. Check Environment Variables
// ============================================
log("\n🔐 Checking Environment Configuration...", "cyan");

// Load .env if exists
if (fs.existsSync(".env")) {
  require("dotenv").config();
  checkPass("Found .env file");
} else {
  checkWarn(".env file not found (will use environment variables)");
}

const requiredEnvVars = ["ESPO_BASE_URL", "ESPO_API_KEY", "ESPO_ENTITIES"];

const optionalEnvVars = [
  "PORT",
  "CORS_ORIGIN",
  "RATE_LIMIT_MAX_REQUESTS",
  "CACHE_REFRESH_INTERVAL_HOURS",
];

requiredEnvVars.forEach((envVar) => {
  if (process.env[envVar]) {
    checkPass(`${envVar} is configured`);
  } else {
    checkFail(`Missing required environment variable: ${envVar}`);
  }
});

optionalEnvVars.forEach((envVar) => {
  if (process.env[envVar]) {
    checkPass(`${envVar} is configured`);
  } else {
    checkWarn(`Optional environment variable not set: ${envVar}`);
  }
});

// ============================================
// 3. Check Dependencies
// ============================================
log("\n📦 Checking Dependencies...", "cyan");

try {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const requiredDeps = ["express", "cors", "dotenv", "node-cache", "node-cron"];

  requiredDeps.forEach((dep) => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      checkPass(`Dependency installed: ${dep}`);
    } else {
      checkFail(`Missing dependency: ${dep}`);
    }
  });

  // Check if node_modules exists
  if (fs.existsSync("node_modules")) {
    checkPass("node_modules directory exists");
  } else {
    checkFail("node_modules not found - run 'npm install'");
  }
} catch (error) {
  checkFail(`Error reading package.json: ${error.message}`);
}

// ============================================
// 4. Syntax Check (Basic)
// ============================================
log("\n🔍 Checking JavaScript Syntax...", "cyan");

const jsFiles = [
  "index.js",
  "controller/espoClient.js",
  "controller/genericController.js",
  "utils/cache.js",
  "utils/cacheWarmer.js",
  "routes/cache.js",
];

jsFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    try {
      require(path.resolve(file));
      checkPass(`Syntax OK: ${file}`);
    } catch (error) {
      checkFail(`Syntax error in ${file}: ${error.message}`);
    }
  }
});

// ============================================
// 5. Check Routes Structure
// ============================================
log("\n🛣️  Checking Routes...", "cyan");

const routeFiles = [
  "routes/generic.js",
  "routes/chat.js",
  "routes/adminChat.js",
  "routes/indexnow.js",
  "routes/cache.js",
];

routeFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    checkPass(`Route file exists: ${file}`);
  } else {
    checkWarn(`Route file not found: ${file}`);
  }
});

// ============================================
// 6. Check Cache Implementation
// ============================================
log("\n💾 Checking Cache Implementation...", "cyan");

try {
  const cacheUtil = require("./utils/cache");
  if (typeof cacheUtil.getCache === "function") {
    checkPass("Cache utility functions available");
  }
  if (typeof cacheUtil.setCache === "function") {
    checkPass("Cache set function available");
  }
  if (typeof cacheUtil.getCacheStats === "function") {
    checkPass("Cache stats function available");
  }
} catch (error) {
  checkFail(`Cache implementation error: ${error.message}`);
}

// ============================================
// 7. Check for Common Issues
// ============================================
log("\n🔧 Checking for Common Issues...", "cyan");

// Check for .git directory
if (fs.existsSync(".git")) {
  checkPass("Git repository initialized");
} else {
  checkWarn("Not a git repository");
}

// Check for .gitignore
if (fs.existsSync(".gitignore")) {
  const gitignore = fs.readFileSync(".gitignore", "utf8");
  if (gitignore.includes("node_modules")) {
    checkPass(".gitignore includes node_modules");
  } else {
    checkWarn(".gitignore should include node_modules");
  }
  if (gitignore.includes(".env")) {
    checkPass(".gitignore includes .env");
  } else {
    checkFail(".gitignore must include .env (security risk!)");
  }
} else {
  checkWarn(".gitignore file not found");
}

// Check for README
if (fs.existsSync("README.md")) {
  checkPass("README.md exists");
} else {
  checkWarn("README.md not found");
}

// ============================================
// 8. Build Summary
// ============================================
log("\n" + "=".repeat(60), "blue");
log("📊 BUILD SUMMARY", "blue");
log("=".repeat(60), "blue");

const totalChecks = checks.length;
const passed = checks.filter((c) => c.status === "pass").length;
const warned = checks.filter((c) => c.status === "warn").length;
const failed = checks.filter((c) => c.status === "fail").length;

log(`\nTotal Checks: ${totalChecks}`);
log(`✅ Passed: ${passed}`, "green");
log(`⚠️  Warnings: ${warned}`, "yellow");
log(`❌ Failed: ${failed}`, "red");

if (errors.length > 0) {
  log("\n❌ BUILD FAILED", "red");
  log("\nErrors that must be fixed:", "red");
  errors.forEach((error, index) => {
    log(`  ${index + 1}. ${error}`, "red");
  });
  process.exit(1);
}

if (warnings.length > 0) {
  log("\n⚠️  BUILD PASSED WITH WARNINGS", "yellow");
  log("\nWarnings (recommended to fix):", "yellow");
  warnings.forEach((warning, index) => {
    log(`  ${index + 1}. ${warning}`, "yellow");
  });
}

if (errors.length === 0 && warnings.length === 0) {
  log("\n✅ BUILD SUCCESSFUL!", "green");
  log("\n🚀 Your project is ready for deployment!", "green");
}

log("\n" + "=".repeat(60), "blue");

// Generate build report
const buildReport = {
  timestamp: new Date().toISOString(),
  status: errors.length === 0 ? "success" : "failed",
  summary: {
    total: totalChecks,
    passed,
    warnings: warned,
    failed,
  },
  checks,
  errors,
  warnings,
};

fs.writeFileSync("build-report.json", JSON.stringify(buildReport, null, 2));
log("\n📄 Build report saved to: build-report.json", "cyan");

// Exit with appropriate code
process.exit(errors.length > 0 ? 1 : 0);
