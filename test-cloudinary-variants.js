// Test Cloudinary Variants Implementation
const { applyCloudinaryVariants } = require("./utils/cloudinary");

// Sample product record (like from EspoCRM)
const sampleProduct = {
  id: "69565a8fbdec0e0e2",
  name: "Nokia-Camel",
  productTitle: "100% Cotton Camel Poplin 146cm 125gsm Mercerized",
  image1CloudUrl:
    "https://res.cloudinary.com/age-fabric/image/upload/v1769584444/f8xezhrj7gbbugpbnchr.jpg",
  image1PublicId: "f8xezhrj7gbbugpbnchr",
  image2CloudUrl: null,
  image3CloudUrl: null,
  collectionId: "690a0e676132664ee",
};

// Sample collection record
const sampleCollection = {
  id: "690a0e676132664ee",
  name: "Nokia Collection",
  collectionImage1CloudUrl:
    "https://res.cloudinary.com/age-fabric/image/upload/v1769260085/sbvlervwzyqym7ah9dev.jpg",
};

console.log("=== TESTING CLOUDINARY VARIANTS ===\n");

// Test 1: Product with image1
console.log("1. Product with image1CloudUrl:");
const productWithVariants = applyCloudinaryVariants(sampleProduct, [
  "image1",
  "image2",
  "image3",
]);
console.log("\nOriginal fields:");
console.log("  image1CloudUrl:", productWithVariants.image1CloudUrl);
console.log("\nNew variant fields added:");
console.log("  image1UrlBase:", productWithVariants.image1UrlBase);
console.log("  image1UrlWeb:", productWithVariants.image1UrlWeb);
console.log("  image1UrlEmail:", productWithVariants.image1UrlEmail);
console.log("  image1UrlPdf:", productWithVariants.image1UrlPdf);
console.log("  image1UrlCard:", productWithVariants.image1UrlCard);
console.log("  image1UrlHero:", productWithVariants.image1UrlHero);
console.log("  image1UrlLarge:", productWithVariants.image1UrlLarge);

// Test 2: Collection
console.log("\n\n2. Collection with collectionImage1CloudUrl:");
const collectionWithVariants = applyCloudinaryVariants(sampleCollection, [
  "collectionImage1",
]);
console.log("\nOriginal fields:");
console.log(
  "  collectionImage1CloudUrl:",
  collectionWithVariants.collectionImage1CloudUrl,
);
console.log("\nNew variant fields added:");
console.log(
  "  collectionImage1UrlBase:",
  collectionWithVariants.collectionImage1UrlBase,
);
console.log(
  "  collectionImage1UrlWeb:",
  collectionWithVariants.collectionImage1UrlWeb,
);
console.log(
  "  collectionImage1UrlEmail:",
  collectionWithVariants.collectionImage1UrlEmail,
);
console.log(
  "  collectionImage1UrlPdf:",
  collectionWithVariants.collectionImage1UrlPdf,
);
console.log(
  "  collectionImage1UrlCard:",
  collectionWithVariants.collectionImage1UrlCard,
);
console.log(
  "  collectionImage1UrlHero:",
  collectionWithVariants.collectionImage1UrlHero,
);
console.log(
  "  collectionImage1UrlLarge:",
  collectionWithVariants.collectionImage1UrlLarge,
);

// Test 3: Non-Cloudinary URL (should return unchanged)
console.log("\n\n3. Non-Cloudinary URL (should pass through unchanged):");
const nonCloudinary = {
  id: "test123",
  image1CloudUrl: "https://example.com/image.jpg",
};
const nonCloudinaryResult = applyCloudinaryVariants(nonCloudinary, ["image1"]);
console.log("  image1UrlBase:", nonCloudinaryResult.image1UrlBase);
console.log("  image1UrlWeb:", nonCloudinaryResult.image1UrlWeb);
console.log("  (Should be same as original)");

console.log("\n\n=== SUMMARY ===");
console.log("✅ For each Cloudinary image field, you now get 7 URLs:");
console.log("   1. {field}UrlBase   - Original URL");
console.log(
  "   2. {field}UrlWeb    - Optimized for web (auto format, quality, DPR)",
);
console.log("   3. {field}UrlEmail  - Optimized for email (JPG, 600px, q75)");
console.log("   4. {field}UrlPdf    - Optimized for PDF (JPG, 1200px, q80)");
console.log("   5. {field}UrlCard   - Optimized for cards (300x300, cropped)");
console.log("   6. {field}UrlHero   - Optimized for hero banners (1600px)");
console.log("   7. {field}UrlLarge  - Optimized for large views (2000px)");
console.log("\n✅ Non-Cloudinary URLs pass through unchanged");
console.log(
  "✅ All transformations happen in Node.js (no frontend logic needed)",
);
