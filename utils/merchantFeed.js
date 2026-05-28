const { getGoogleProductCategoryId } = require("./googleProductCategory");

// Length caps. Internal data-quality gates; misalignment with Google's limits
// here would cause rejected items, so kept conservative.
const MAX_ID_LEN = 50;
const MAX_MPN_LEN = 70;
const MAX_BRAND_LEN = 70;
const MAX_TITLE_LEN = 150;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_COLORS = 3;
const MAX_MATERIALS = 3;
const MAX_VALUE_LEN = 100;
const MAX_SKIPPED_DETAILS = 50;

// Sentinel values our CMS sometimes emits in place of real null. These should
// be treated as "no value" rather than passed through to the feed.
const NULL_TOKENS = new Set([
  "",
  "n/a", "na", "n.a", "n.a.",
  "none", "null", "-",
  "various", "assorted", "multi", "multicolor", "multi-color",
  "variety", "tbd", "tba",
]);

// Color names that look like hex codes belong in hex[], not color[].
const HEX_PATTERN = /^#?[0-9a-f]{3,8}$/i;

// Price strings containing range markers or multiple numeric groups are
// ambiguous and must be rejected — e.g. "120-150", "120 to 150", "120 or 150".
const PRICE_RANGE_INDICATORS = /\b(to|range|onwards|or)\b|—|–|\d[\s.]*-[\s.]*\d/i;

function xmlEscape(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return !NULL_TOKENS.has(normalized);
}

function cleanAttributeValue(value, maxLen = MAX_VALUE_LEN) {
  if (!isMeaningful(value)) return "";
  const text = stripHtml(value).trim();
  if (!isMeaningful(text) || text.length > maxLen) return "";
  return text;
}

function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated).trim();
}

// Strip HTML + normalize whitespace, but preserve inner quotes/apostrophes —
// they're often meaningful in product names (e.g. brand names with apostrophes,
// measurement marks like 57").
function sanitizeTitle(raw) {
  const text = stripHtml(raw).trim();
  if (!text) return "";
  return truncateAtWord(text, MAX_TITLE_LEN);
}

// Returns null for missing, non-positive, or ambiguous price values.
// Ambiguous = anything with range markers, "to"/"or", or multiple numeric groups.
function inspectPrice(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { status: "missing", value: null };
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0
      ? { status: "valid", value: Math.round(raw * 100) / 100 }
      : { status: "missing", value: null };
  }
  const str = String(raw).trim();
  if (!str) return { status: "missing", value: null };
  if (PRICE_RANGE_INDICATORS.test(str)) {
    return { status: "ambiguous", value: null };
  }

  // Extract numeric groups; reject if more than one (e.g. "120 150").
  const cleaned = str.replace(/[^\d.,]/g, " ").trim();
  const groups = cleaned.match(/[\d.,]+/g);
  if (!groups) return { status: "missing", value: null };
  if (groups.length !== 1) return { status: "ambiguous", value: null };

  const numeric = Number.parseFloat(groups[0].replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { status: "missing", value: null };
  }
  return { status: "valid", value: Math.round(numeric * 100) / 100 };
}

function parsePrice(raw) {
  const result = inspectPrice(raw);
  return result.status === "valid" ? result.value : null;
}

// Frontend pricing helper order (src/lib/product-pricing.ts) — kept in sync so
// feed and landing page price always agree.
const PRICE_FIELDS = [
  "price", "currentPrice", "indicativePrice", "productPrice",
  "pricePerMeter", "pricePerUnit", "sellingPrice", "salesPrice",
];

function getPriceResult(product) {
  for (const field of PRICE_FIELDS) {
    const parsed = inspectPrice(product?.[field]);
    if (parsed.status === "ambiguous") {
      return { price: null, skipReason: "ambiguous_price" };
    }
    if (parsed.status === "valid") {
      return { price: parsed.value, skipReason: null };
    }
  }
  return { price: null, skipReason: "missing_price" };
}

function getPrice(product) {
  return getPriceResult(product).price;
}

function getProductRef(product) {
  return {
    id: cleanAttributeValue(product?.id, 80),
    fabricCode: stripHtml(product?.fabricCode).trim(),
    name: sanitizeTitle(product?.productTitle || product?.name),
    slug: stripHtml(product?.productslug).trim(),
  };
}

function hasValidSlug(product) {
  const slug = String(product?.productslug ?? "").trim().toLowerCase();
  return slug.length > 0 && slug !== "pending";
}

// Image must be absolute https URL. Cloudinary returns https; any http URL
// is almost certainly a data-entry error. Also reject known fallback patterns.
function isValidImageUrl(url) {
  if (!url) return false;
  const trimmed = String(url).trim();
  if (!trimmed) return false;
  if (!/^https:\/\//i.test(trimmed)) return false;
  if (/ProductFallBack/i.test(trimmed)) return false;
  return true;
}

// Filter and join color/material values per Google's slash-separated convention.
// Drops hex codes, generic terms ("variety", "n/a"), and oversized values.
function buildSlashList(values, maxItems) {
  if (!Array.isArray(values)) return "";
  const cleaned = [];
  for (const raw of values) {
    const text = cleanAttributeValue(raw);
    if (!text) continue;
    if (HEX_PATTERN.test(text)) continue;
    cleaned.push(text);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned.join("/");
}

function getPattern(product) {
  const motif = cleanAttributeValue(product?.motif);
  if (motif) return motif;
  const design = cleanAttributeValue(product?.design);
  if (design) return design;
  return "";
}

function getProductType(product) {
  return [product?.category, product?.structure, product?.design]
    .map((v) => cleanAttributeValue(v))
    .filter(Boolean)
    .join(" > ");
}

function buildSpecValue(label, value, suffix = "") {
  const text = cleanAttributeValue(value);
  if (!text) return "";
  const needsSuffix = suffix && !new RegExp(`\\b${suffix}\\b`, "i").test(text);
  return `${label}: ${text}${needsSuffix ? ` ${suffix}` : ""}`;
}

// Compose description: main CMS text + fabric-specific specs (GSM, width, MOQ).
// MOQ helps B2B buyers and Google search matching since fabric is commonly
// searched with these specs. Capped at MAX_DESCRIPTION_LEN at a word boundary.
function buildDescription(product) {
  const main =
    stripHtml(product?.fullProductDescription) ||
    stripHtml(product?.shortProductDescription) ||
    (isMeaningful(product?.productTagline) ? String(product.productTagline).trim() : "") ||
    "";

  const specs = [];
  const gsm = buildSpecValue("GSM", product?.gsm);
  const width = buildSpecValue("Width", product?.cm, "cm");
  const moq = cleanAttributeValue(product?.salesMOQ);
  const moqUnit = cleanAttributeValue(product?.uM);
  if (gsm) specs.push(gsm);
  if (width) specs.push(width);
  if (moq && moqUnit) {
    specs.push(`Minimum order: ${moq} ${moqUnit}`);
  }

  let combined;
  if (!specs.length) combined = main;
  else if (!main) combined = specs.join(". ") + ".";
  else combined = `${main} ${specs.join(". ")}.`;

  return truncateAtWord(combined, MAX_DESCRIPTION_LEN);
}

function buildItem(product, {
  siteOrigin,
  brandName,
  seenIds,
  skipped,
  skippedDetails,
}) {
  // Gates run top-to-bottom; first failure increments the matching skip
  // counter and short-circuits. Each gate maps to one X-Feed-Skipped-Reasons key.
  const skipProduct = (reason) => {
    skipped[reason]++;
    if (skippedDetails.length < MAX_SKIPPED_DETAILS) {
      skippedDetails.push({ reason, ...getProductRef(product) });
    }
    return null;
  };

  if (!hasValidSlug(product)) return skipProduct("invalid_slug");

  const mpn = stripHtml(product?.fabricCode).trim();
  if (!isMeaningful(mpn)) return skipProduct("missing_mpn");
  if (mpn.length > MAX_MPN_LEN) return skipProduct("invalid_id");
  if (mpn.length > MAX_ID_LEN) return skipProduct("invalid_id");

  // Case-insensitive duplicate detection. Google's docs say IDs are
  // case-sensitive, but they also warn that case-only differences may be
  // interpreted as the same product. Treating them as duplicates is safer.
  const idKey = mpn.toLowerCase();
  if (seenIds.has(idKey)) return skipProduct("duplicate_id");

  const { price, skipReason } = getPriceResult(product);
  if (price === null) {
    return skipProduct(skipReason);
  }

  const title = sanitizeTitle(product.productTitle || product.name);
  if (!title) return skipProduct("missing_title");

  const description = buildDescription(product);
  if (!description) return skipProduct("missing_description");

  if (!isValidImageUrl(product.image1CloudUrl)) {
    return skipProduct("invalid_image");
  }

  // Eligibility passed — register id and emit.
  seenIds.add(idKey);

  const link = `${siteOrigin}/fabric/${product.productslug}`;
  const additionalImages = [product.image2CloudUrl, product.image3CloudUrl].filter(isValidImageUrl);
  const googleCategoryId = getGoogleProductCategoryId(product);
  const material = buildSlashList(product.content, MAX_MATERIALS);
  const color = buildSlashList(product.color, MAX_COLORS);
  const pattern = getPattern(product);
  const productType = getProductType(product);

  const lines = [
    `      <item>`,
    `        <g:id>${xmlEscape(mpn)}</g:id>`,
    `        <title>${xmlEscape(title)}</title>`,
    `        <description>${xmlEscape(description)}</description>`,
    `        <link>${xmlEscape(link)}</link>`,
    `        <g:image_link>${xmlEscape(product.image1CloudUrl)}</g:image_link>`,
    ...additionalImages.map((u) => `        <g:additional_image_link>${xmlEscape(u)}</g:additional_image_link>`),
    `        <g:availability>in_stock</g:availability>`,
    `        <g:price>${price.toFixed(2)} INR</g:price>`,
    `        <g:brand>${xmlEscape(brandName)}</g:brand>`,
    `        <g:mpn>${xmlEscape(mpn)}</g:mpn>`,
    `        <g:condition>new</g:condition>`,
    `        <g:google_product_category>${xmlEscape(googleCategoryId)}</g:google_product_category>`,
  ];

  if (productType) lines.push(`        <g:product_type>${xmlEscape(productType)}</g:product_type>`);
  if (material) lines.push(`        <g:material>${xmlEscape(material)}</g:material>`);
  if (color) lines.push(`        <g:color>${xmlEscape(color)}</g:color>`);
  if (pattern) lines.push(`        <g:pattern>${xmlEscape(pattern)}</g:pattern>`);

  lines.push(`      </item>`);
  return lines.join("\n");
}

function buildFeed(products, { siteOrigin, brandName, feedTitle, feedLink, feedDescription }) {
  const seenIds = new Set();
  const skippedDetails = [];
  const skipped = {
    invalid_slug: 0,
    missing_mpn: 0,
    invalid_id: 0,
    duplicate_id: 0,
    missing_price: 0,
    ambiguous_price: 0,
    missing_title: 0,
    missing_description: 0,
    invalid_image: 0,
  };

  const itemXmls = products
    .map((p) => buildItem(p, {
      siteOrigin,
      brandName,
      seenIds,
      skipped,
      skippedDetails,
    }))
    .filter(Boolean);

  const itemCount = itemXmls.length;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(feedTitle)}</title>
    <link>${xmlEscape(feedLink)}</link>
    <description>${xmlEscape(feedDescription)}</description>
${itemXmls.join("\n")}
  </channel>
</rss>`;

  return { xml, itemCount, skipped, skippedDetails };
}

module.exports = {
  buildFeed,
  buildItem,
  xmlEscape,
  stripHtml,
  parsePrice,
  getPrice,
  sanitizeTitle,
  buildDescription,
  isMeaningful,
  MAX_BRAND_LEN,
  MAX_ID_LEN,
  MAX_MPN_LEN,
};