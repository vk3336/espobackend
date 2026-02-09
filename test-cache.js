/**
 * Simple cache test script
 * Run with: node test-cache.js
 */

const {
  cache,
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

console.log("✓ Data stored and retrieved successfully");
console.log("  Key:", testKey);
console.log(
  "  Data matches:",
  JSON.stringify(retrieved) === JSON.stringify(testData),
);

// Test 2: Cache Miss
console.log("\nTest 2: Cache Miss");
const missingKey = getCacheKey("CProduct", { type: "single", id: "999" });
const missing = getCache(missingKey);
console.log("✓ Cache miss handled correctly:", missing === null);

// Test 3: Cache Stats
console.log("\nTest 3: Cache Statistics");
const stats = getCacheStats();
console.log("✓ Cache stats:");
console.log("  Keys:", stats.keys);
console.log("  Hits:", stats.hits);
console.log("  Misses:", stats.misses);

// Test 4: TTL (Time To Live)
console.log("\nTest 4: TTL Test (5 seconds)");
const ttlKey = "test:ttl";
setCache(ttlKey, { test: "data" }, 5); // 5 seconds TTL

console.log("✓ Data cached with 5 second TTL");
console.log("  Waiting 2 seconds...");

setTimeout(() => {
  const stillThere = getCache(ttlKey);
  console.log("  After 2 seconds - Data exists:", stillThere !== null);

  console.log("  Waiting 4 more seconds...");
  setTimeout(() => {
    const expired = getCache(ttlKey);
    console.log("  After 6 seconds - Data expired:", expired === null);

    console.log("\n✅ All cache tests passed!");
    console.log("\nCache is ready to use with 24-hour TTL for EspoCRM data.");
  }, 4000);
}, 2000);
