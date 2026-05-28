const { espoRequest } = require("./espoClient");
const { buildFeed, MAX_BRAND_LEN } = require("../utils/merchantFeed");

// EspoCRM list call with a where clause, paginated. Matches the public
// catalogue filter used everywhere else in this backend
// (genericController.js:794-810): merchTags arrayAnyOf ["ecatalogue"].
//
// PAGE_SIZE must stay <= EspoCRM's recordListMaxSizeLimit. The existing
// PUBLIC_API_MAX_LIMIT (genericController.js:157) is 100, so we use the same.
// Larger values (e.g. 500) cause EspoCRM to return 403.
//
// Pagination does NOT trust the `total` field — this EspoCRM instance returns
// disableCount-style responses (total is missing or -1), so we paginate by
// fetching pages sequentially until a page returns fewer items than requested.
async function fetchAllEcatalogueProducts() {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50; // safety cap: 50 * 100 = 5000 products max

  const fetchPage = (offset) =>
    espoRequest(`/CProduct`, {
      query: {
        searchParams: JSON.stringify({
          maxSize: PAGE_SIZE,
          offset,
          where: [
            {
              type: "arrayAnyOf",
              attribute: "merchTags",
              value: ["ecatalogue"],
            },
          ],
        }),
      },
    });

  const all = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < MAX_PAGES) {
    const res = await fetchPage(offset);
    const list = res?.list ?? [];

    if (list.length === 0) break;

    all.push(...list);
    pageCount++;

    if (list.length < PAGE_SIZE) break;
    offset += list.length;
  }

  console.log(
    `[feed] Fetched ${all.length} ecatalogue products across ${pageCount} page(s)`
  );

  return all;
}

// Brand resolution: env override > CMS legalName > CMS name. The env override
// is for cases where the customer-facing brand differs from legalName, or where
// legalName is too long to fit Google's brand attribute cap.
async function fetchBrandName() {
  const envBrand = String(process.env.MERCHANT_BRAND_NAME || "").trim();
  if (envBrand) return envBrand;

  const res = await espoRequest(`/CCompanyInformation`, {
    query: {
      searchParams: JSON.stringify({ maxSize: 50, offset: 0 }),
    },
  });
  const list = res?.list ?? [];
  const ageRecord = list.find((c) => c.name === "AGE") ?? list[0];
  const fromCms = (ageRecord?.legalName || ageRecord?.name || "").trim();
  return fromCms;
}

async function getGoogleMerchantFeed(req, res, next) {
  try {
    const frontendUrl = String(process.env.FRONTEND_URL || "")
      .trim()
      .replace(/\/$/, "");
    if (!frontendUrl) {
      const err = new Error("FRONTEND_URL env var is not configured");
      err.status = 500;
      throw err;
    }

    const [products, brandName] = await Promise.all([
      fetchAllEcatalogueProducts(),
      fetchBrandName(),
    ]);

    if (!brandName) {
      const err = new Error(
        "Brand name could not be resolved (set MERCHANT_BRAND_NAME or ensure CCompanyInformation has a legalName)"
      );
      err.status = 500;
      throw err;
    }

    if (brandName.length > MAX_BRAND_LEN) {
      const err = new Error(
        `Brand name (${brandName.length} chars) exceeds Google's ${MAX_BRAND_LEN}-char limit. ` +
          `Set MERCHANT_BRAND_NAME to a shorter customer-facing brand name.`
      );
      err.status = 500;
      throw err;
    }

    const { xml, itemCount, skipped, skippedDetails } = buildFeed(products, {
      siteOrigin: frontendUrl,
      brandName,
      feedTitle: `${brandName} - Fabric Catalog`,
      feedLink: frontendUrl,
      feedDescription: "Product feed for Google Merchant Center",
    });

    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
    const skippedReasons = Object.entries(skipped)
      .filter(([, n]) => n > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");

    // Hard fail on zero items — prevents a CMS field rename or bad deploy from
    // silently replacing the live feed with an empty one (which would have all
    // products disapproved by Merchant Center).
    if (itemCount === 0) {
      const err = new Error(
        `Feed has zero valid items after eligibility gates. Fetched=${products.length} skipped=${skippedReasons || "(none)"}`
      );
      err.status = 500;
      throw err;
    }

    console.warn(
      `[feed] emitted=${itemCount} skipped_total=${skippedTotal} ${skippedReasons || "(no skips)"}`
    );
    if (skippedDetails.length) {
      console.warn(`[feed] skipped_details=${JSON.stringify(skippedDetails)}`);
    }

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("X-Feed-Item-Count", String(itemCount));
    res.set("X-Feed-Fetched-Count", String(products.length));
    res.set("X-Feed-Skipped-Total", String(skippedTotal));
    if (skippedReasons) res.set("X-Feed-Skipped-Reasons", skippedReasons);
    res.set("X-Feed-Generated-At", new Date().toISOString());
    res.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
    );
    res.set(
      "Vercel-CDN-Cache-Control",
      "max-age=3600, stale-while-revalidate=86400"
    );
    res.set(
      "CDN-Cache-Control",
      "max-age=3600, stale-while-revalidate=86400"
    );
    res.send(xml);
  } catch (err) {
    next(err);
  }
}

module.exports = { getGoogleMerchantFeed };