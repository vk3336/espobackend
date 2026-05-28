// Google Product Category mapping for the Merchant Center feed.
//
// Source: Google Product Taxonomy (verified ID 47 = Fabric under
// Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts >
// Art & Crafting Materials > Textiles > Fabric).
//
// Only the numeric ID is emitted in the feed (Google recommends ID over path).
// The path is kept here purely for developer readability.

const DEFAULT_GOOGLE_PRODUCT_CATEGORY_ID = "47";
const DEFAULT_GOOGLE_PRODUCT_CATEGORY_PATH =
  "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts > Art & Crafting Materials > Textiles > Fabric";

// Keyed by INTERNAL category slug (lowercased). Add entries as edge cases appear.
const CATEGORY_OVERRIDES = {
  // "printable-fabric":   { id: "505396", path: "... > Textiles > Printable Fabric" },
  // "fabric-repair-kits": { id: "6382",   path: "... > Art & Craft Kits > Fabric Repair Kits" },
  // "interfacing":        { id: "7076",   path: "... > Textiles > Interfacing" },
};

// Keyed by fabricCode. Rare exceptions only.
const PRODUCT_OVERRIDES = {
  // "ABC-12345": "505396",
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function getGoogleProductCategoryId(product) {
  if (!product) return DEFAULT_GOOGLE_PRODUCT_CATEGORY_ID;
  if (PRODUCT_OVERRIDES[product.fabricCode]) return PRODUCT_OVERRIDES[product.fabricCode];
  const slug = slugify(product.category);
  if (CATEGORY_OVERRIDES[slug]) return CATEGORY_OVERRIDES[slug].id;
  return DEFAULT_GOOGLE_PRODUCT_CATEGORY_ID;
}

module.exports = {
  DEFAULT_GOOGLE_PRODUCT_CATEGORY_ID,
  DEFAULT_GOOGLE_PRODUCT_CATEGORY_PATH,
  getGoogleProductCategoryId,
};