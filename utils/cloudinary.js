/**
 * Cloudinary URL Transform Utility
 *
 * Centralized Cloudinary optimization logic for Node.js API
 * - No SDK required (URL manipulation only)
 * - No API keys/secrets needed
 * - Provides standardized image variants for web, email, PDF, cards, hero, and large views
 *
 * Critical for: PageSpeed, LCP, SEO, PDF quality, Email rendering, Bandwidth optimization
 */

// ✅ Standard Cloudinary transformation presets (DO NOT MODIFY NAMES)
const CLOUDINARY_TRANSFORMS = {
  web: "f_auto,q_auto,w_auto,dpr_auto,c_limit",
  email: "f_jpg,q_75,w_600,c_limit",
  pdf: "f_jpg,q_80,w_1200,c_limit",
  card: "f_auto,q_auto,w_300,h_300,c_fill,g_auto",
  hero: "f_auto,q_auto,w_1600,dpr_auto,c_limit",
  large: "f_auto,q_auto,w_2000,dpr_auto,c_limit",
};

/**
 * Build Cloudinary URL with transformation
 *
 * @param {string} baseUrl - Original Cloudinary URL from EspoCRM
 * @param {string} variant - Transform variant: web, email, pdf, card, hero, large
 * @returns {string|null} - Transformed URL or original if not Cloudinary or null if invalid
 */
function buildCloudinaryUrl(baseUrl, variant) {
  // Validate inputs
  if (!baseUrl || typeof baseUrl !== "string") {
    return null;
  }

  // ✅ CRITICAL: Only process Cloudinary URLs
  if (!baseUrl.includes("cloudinary")) {
    return baseUrl; // Return original URL unchanged if not Cloudinary
  }

  // Validate variant
  if (!variant || !CLOUDINARY_TRANSFORMS[variant]) {
    console.warn(
      `[Cloudinary] Invalid variant "${variant}", returning original URL`,
    );
    return baseUrl;
  }

  const transform = CLOUDINARY_TRANSFORMS[variant];

  try {
    // Parse URL
    const url = new URL(baseUrl);

    // Cloudinary URL structure: https://res.cloudinary.com/{cloud_name}/image/upload/{transforms}/{public_id}.{ext}
    const pathParts = url.pathname.split("/");

    // Find "upload" or "video" segment
    const uploadIndex = pathParts.findIndex(
      (part) => part === "upload" || part === "video",
    );

    if (uploadIndex === -1) {
      console.warn(
        `[Cloudinary] Could not find upload/video segment in URL: ${baseUrl}`,
      );
      return baseUrl;
    }

    // Check if transforms already exist after upload
    const existingTransformIndex = uploadIndex + 1;
    const hasExistingTransform =
      pathParts[existingTransformIndex] &&
      pathParts[existingTransformIndex].includes(",");

    if (hasExistingTransform) {
      // Replace existing transform
      pathParts[existingTransformIndex] = transform;
    } else {
      // Insert new transform after upload
      pathParts.splice(existingTransformIndex, 0, transform);
    }

    // Rebuild URL
    url.pathname = pathParts.join("/");

    return url.toString();
  } catch (error) {
    console.error(
      `[Cloudinary] Error building URL for variant "${variant}":`,
      error.message,
    );
    return baseUrl; // Return original on error
  }
}

/**
 * Apply Cloudinary variants to all image fields in a record
 *
 * @param {Object} record - Single record with Cloudinary image fields
 * @param {Array<string>} imageFields - Array of EXACT field names from EspoCRM (e.g., ["image1CloudUrl", "authorimage"])
 * @returns {Object} - Record with added variant fields
 */
function applyCloudinaryVariants(record, imageFields = []) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const result = { ...record };

  imageFields.forEach((fieldName) => {
    // Use the exact field name provided
    const baseUrl = record[fieldName];

    if (!baseUrl) {
      return; // Skip if no URL exists
    }

    // Remove "CloudUrl" suffix if present to get base name for variant fields
    const baseField = fieldName.replace(/CloudUrl$/i, "");

    // Add base URL (original)
    result[`${baseField}UrlBase`] = baseUrl;

    // Add all variants
    Object.keys(CLOUDINARY_TRANSFORMS).forEach((variant) => {
      const variantField = `${baseField}Url${variant.charAt(0).toUpperCase() + variant.slice(1)}`;
      result[variantField] = buildCloudinaryUrl(baseUrl, variant);
    });
  });

  return result;
}

module.exports = {
  buildCloudinaryUrl,
  applyCloudinaryVariants,
  CLOUDINARY_TRANSFORMS,
};
