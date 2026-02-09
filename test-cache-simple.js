/**
 * Simple synchronous cache test
 * Run with: node test-cache-simple.js
 */

const {
  getCacheKey,
  getCache,
  setCache,
  getCacheStats,
} = require("./utils/cache");

console.log("Testing node-cache implementation...\n");

// Test 1: Set and Get
console.log("Test 1: Set and Get");
const testKey = getCacheKey("CProduct", {
  type: "all",
  orderBy: "",
  order: "",
});
const testData = { list: [{ id: "1", name: "Test Product" }], total: 1 };

setCache(testKey, testData);
const retrieved = getCache(testKey);

if (JSON.stringify(retrieved) === JSON.stringify(testData)) {
  console.log("✅ PASS: Data stored and retrieved successfully");
} else {
  console.log("❌ FAIL: Data mismatch");
}

// Test 2: Cache Miss
console.log("\nTest 2: Cache Miss");
const missingKey = getCacheKey("CProduct", { type: "single", id: "999" });
const missing = getCache(missingKey);

if (missing === null) {
  console.log("✅ PASS: Cache miss handled correctly");
} else {
  console.log("❌ FAIL: Should return null for missing key");
}

// Test 3: Cache Stats
console.log("\nTest 3: Cache Statistics");
const stats = getCacheStats();
console.log("Cache stats:");
console.log("  Keys:", stats.keys);
console.log("  Hits:", stats.hits);
console.log("  Misses:", stats.misses);

if (stats.keys > 0) {
  console.log("✅ PASS: Cache has keys");
} else {
  console.log("❌ FAIL: Cache should have keys");
}

console.log("\n✅ All tests completed!");
console.log("Cache is ready for 24-hour EspoCRM data storage.");
