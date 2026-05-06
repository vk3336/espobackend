const { espoRequest } = require("./espoClient");
const { attachCollections, attachRelatedEntities } = require("../utils/espo");
const {
  getCacheKey,
  getCache,
  setCache,
  deleteCacheByEntity,
} = require("../utils/cache");
const { revalidateFrontends } = require("../utils/revalidateFrontends");
const { applyCloudinaryVariants } = require("../utils/cloudinary");

/* ------------------------------ ENV helpers ------------------------------ */
function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseCsvEnvList(envKey, fallback = []) {
  const raw = cleanStr(process.env[envKey]);
  if (!raw) return fallback;

  const list = raw
    .split(",")
    .map((x) => cleanStr(x))
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.length ? out : fallback;
}

/* ------------------------------ Text normalization ------------------------------ */
// fixes: "Nokia-607" vs "Nokia-607" vs "Nokia–607"
function normText(v) {
  return cleanStr(v)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-") // all hyphen-like chars => "-"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function eqLoose(a, b) {
  return normText(a) === normText(b);
}

function includesLoose(hay, needle) {
  const h = normText(hay);
  const n = normText(needle);
  return !!h && !!n && h.includes(n);
}

/* ------------------------------ Paging helper ------------------------------ */
// In-flight request tracking to prevent duplicate fetches
const fetchAllRecordsInflight = new Map();

// Helper: Convert value to positive number or fallback
function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function intInRange(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.min(max, Math.max(min, Math.floor(fallback)));
  }
  const normalized = Math.floor(n);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

// Helper: Parse EspoCRM date string to milliseconds
function parseEspoDateMs(value) {
  if (!value) return 0;

  let iso = String(value).trim();
  if (!iso) return 0;

  iso = iso.includes("T") ? iso : iso.replace(" ", "T");

  if (!/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    iso += "Z";
  }

  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function compareFieldValues(leftValue, rightValue) {
  if (leftValue === rightValue) return 0;
  if (leftValue === null || leftValue === undefined) return 1;
  if (rightValue === null || rightValue === undefined) return -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  const leftDate = parseEspoDateMs(leftValue);
  const rightDate = parseEspoDateMs(rightValue);
  if (leftDate && rightDate) {
    return leftDate - rightDate;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortRecords(records, orderBy, order) {
  if (!orderBy) return records;

  const direction = cleanStr(order).toLowerCase() === "desc" ? -1 : 1;
  return [...(records || [])].sort((left, right) => {
    const compared = compareFieldValues(left?.[orderBy], right?.[orderBy]);
    return compared * direction;
  });
}

// Helper: Get maximum modifiedAt value from records
function getMaxModifiedAt(records) {
  let maxValue = null;
  let maxMs = 0;

  for (const record of records || []) {
    const value = record?.modifiedAt;
    const ms = parseEspoDateMs(value);

    if (value && ms >= maxMs) {
      maxMs = ms;
      maxValue = value;
    }
  }

  return maxValue;
}

function formatEspoDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

const PUBLIC_API_DEFAULT_LIMIT = intInRange(
  process.env.PUBLIC_API_DEFAULT_LIMIT,
  20,
  1,
  100,
);
const PUBLIC_API_MAX_LIMIT = intInRange(
  process.env.PUBLIC_API_MAX_LIMIT,
  100,
  1,
  500,
);
const PUBLIC_API_MAX_PAGE = intInRange(
  process.env.PUBLIC_API_MAX_PAGE,
  100000,
  1,
  1000000,
);

// Helper: Fetch records with pagination
async function fetchRecordsPaged(entityName, { orderBy, order, select, where } = {}) {
  const pageSize = toPositiveNumber(process.env.ESPO_LIST_PAGE_SIZE, 200);
  const maxTotal = toPositiveNumber(process.env.ESPO_LIST_MAX_TOTAL, 5000);

  let offset = 0;
  let all = [];
  let total = null;

  while (true) {
    const searchParams = {
      maxSize: pageSize,
      offset,
    };

    if (orderBy) searchParams.orderBy = orderBy;
    if (order) searchParams.order = order;
    if (select) searchParams.select = select;
    if (where) searchParams.where = where;

    const data = await espoRequest(`/${entityName}`, {
      query: {
        searchParams: JSON.stringify(searchParams),
      },
    });

    const list = data?.list ?? [];
    const t = typeof data?.total === "number" ? data.total : null;

    if (total === null && t !== null) total = t;

    all = all.concat(list);
    offset += list.length;

    if (list.length === 0) break;
    if (total !== null && offset >= total) break;
    if (all.length >= maxTotal) break;
    if (list.length < pageSize) break;
  }

  return {
    list: all.slice(0, maxTotal),
    total: total !== null ? total : all.length,
  };
}

async function fetchEntityPage(
  entityName,
  { page = 1, limit = PUBLIC_API_DEFAULT_LIMIT, orderBy, order, select, where } = {},
) {
  const searchParams = {
    maxSize: limit,
    offset: (page - 1) * limit,
  };

  if (orderBy) searchParams.orderBy = orderBy;
  if (order) searchParams.order = order;
  if (select) searchParams.select = select;
  if (Array.isArray(where) && where.length > 0) {
    searchParams.where = where;
  }

  return espoRequest(`/${entityName}`, {
    query: {
      searchParams: JSON.stringify(searchParams),
    },
  });
}

async function fetchEntityTotal(entityName) {
  const data = await espoRequest(`/${entityName}`, {
    query: {
      searchParams: JSON.stringify({
        maxSize: 1,
        offset: 0,
      }),
    },
  });

  return typeof data?.total === "number" ? data.total : null;
}

// Helper: Merge records by ID (newer records override older ones)
function mergeRecordsById(oldRecords, changedRecords) {
  const byId = new Map();

  for (const record of oldRecords || []) {
    if (record?.id) byId.set(record.id, record);
  }

  for (const record of changedRecords || []) {
    if (record?.id) byId.set(record.id, record);
  }

  return Array.from(byId.values());
}

// Fetch ALL records for list endpoints with delta refresh support
async function fetchAllRecords(entityName, { orderBy, order, select } = {}) {
  const cacheKey = getCacheKey(entityName, {
    type: "all",
    orderBy: orderBy || "",
    order: order || "",
    select: Array.isArray(select) ? select.join(",") : select || "",
  });

  if (fetchAllRecordsInflight.has(cacheKey)) {
    return fetchAllRecordsInflight.get(cacheKey);
  }

  const task = (async () => {
    const cached = getCache(cacheKey, entityName);

    const deltaRefreshSeconds = toPositiveNumber(
      process.env.ESPO_DELTA_REFRESH_SECONDS,
      300,
    );

    const fullRefreshSeconds = toPositiveNumber(
      process.env.ESPO_FULL_REFRESH_SECONDS,
      86400,
    );

    const cacheTtlSeconds = toPositiveNumber(
      process.env.ESPO_CACHE_TTL_SECONDS,
      172800,
    );

    const now = Date.now();
    const runFullRefresh = async (reason = "") => {
      if (reason) {
        console.log(`[fetchAllRecords] ${entityName} - full refresh (${reason})`);
      } else {
        console.log(`[fetchAllRecords] ${entityName} - full refresh`);
      }

      const fullData = await fetchRecordsPaged(entityName, {
        orderBy,
        order,
        select,
      });

      const sortedList = sortRecords(fullData.list, orderBy, order);
      const result = {
        list: sortedList,
        total: fullData.total,
        _cacheMeta: {
          lastFullFetchAt: Date.now(),
          lastRefreshAt: Date.now(),
          maxModifiedAt: getMaxModifiedAt(sortedList),
          refreshType: "full",
          totalRecordsFetched: sortedList?.length || 0,
        },
      };

      setCache(cacheKey, result, cacheTtlSeconds, entityName);
      console.log(
        `[fetchAllRecords] ${entityName} - full refresh complete: ${sortedList?.length || 0} records`,
      );

      return result;
    };

    if (cached) {
      const meta = cached._cacheMeta || {};
      const lastRefreshAt = Number(meta.lastRefreshAt || meta.lastFullFetchAt || 0);
      const lastFullFetchAt = Number(meta.lastFullFetchAt || 0);
      const cachedList = Array.isArray(cached.list) ? cached.list : [];

      const isDeltaFresh = now - lastRefreshAt < deltaRefreshSeconds * 1000;
      const needsFullRefresh = now - lastFullFetchAt > fullRefreshSeconds * 1000;

      if (isDeltaFresh) {
        console.log(`[fetchAllRecords] ${entityName} - serving from cache (fresh)`);
        return cached;
      }

      if (!needsFullRefresh) {
        let currentTotal = null;
        try {
          currentTotal = await fetchEntityTotal(entityName);
        } catch (error) {
          console.warn(
            `[fetchAllRecords] Unable to probe total for ${entityName}; continuing with delta refresh:`,
            error.message,
          );
        }

        if (currentTotal !== null && currentTotal < cachedList.length) {
          return runFullRefresh("delete detected");
        }

        const lastModifiedAt =
          meta.maxModifiedAt || getMaxModifiedAt(cachedList);

        if (lastModifiedAt) {
          try {
            console.log(`[fetchAllRecords] ${entityName} - delta refresh from ${lastModifiedAt}`);
            const deltaData = await fetchRecordsPaged(entityName, {
              orderBy: "modifiedAt",
              order: "asc",
              select,
              where: [
                {
                  type: "greaterThanOrEquals",
                  attribute: "modifiedAt",
                  value: lastModifiedAt,
                },
              ],
            });

            let mergedList = mergeRecordsById(cachedList, deltaData.list || []);
            mergedList = sortRecords(mergedList, orderBy, order);

            if (currentTotal !== null && mergedList.length !== currentTotal) {
              return runFullRefresh("count drift detected");
            }

            const result = {
              list: mergedList,
              total: currentTotal !== null ? currentTotal : mergedList.length,
              _cacheMeta: {
                lastFullFetchAt,
                lastRefreshAt: Date.now(),
                maxModifiedAt: getMaxModifiedAt(mergedList) || lastModifiedAt,
                refreshType: "delta",
                deltaRecordsFetched: deltaData.list?.length || 0,
              },
            };

            setCache(cacheKey, result, cacheTtlSeconds, entityName);
            console.log(`[fetchAllRecords] ${entityName} - delta refresh complete: ${deltaData.list?.length || 0} changed, ${mergedList.length} total`);
            return result;
          } catch (error) {
            console.warn(
              `[fetchAllRecords] Delta refresh failed for ${entityName}; serving cached data:`,
              error.message,
            );

            return cached;
          }
        }
      }

      return runFullRefresh("stale cache window elapsed");
    }

    return runFullRefresh();
  })();

  fetchAllRecordsInflight.set(cacheKey, task);

  try {
    return await task;
  } finally {
    fetchAllRecordsInflight.delete(cacheKey);
  }
}

/* ------------------------------ Collection fields ------------------------------ */
const DEFAULT_COLLECTION_SELECT_FIELDS = [
  "id",
  "name",
  "slug",
  "collectionImage1CloudUrl",
  "altTextCollectionImage1",
  "collectionvideoURL",
  "collectionaltTextVideo",
];

const COLLECTION_SELECT_FIELDS = parseCsvEnvList(
  "ESPO_COLLECTION_SELECT_FIELDS",
  DEFAULT_COLLECTION_SELECT_FIELDS,
);

/* ------------------------------ Location fields ------------------------------ */
const DEFAULT_LOCATION_SELECT_FIELDS = ["id", "name", "slug"];

const LOCATION_SELECT_FIELDS = parseCsvEnvList(
  "ESPO_LOCATION_SELECT_FIELDS",
  DEFAULT_LOCATION_SELECT_FIELDS,
);

/* ------------------------------ Product fields ------------------------------ */
const DEFAULT_PRODUCT_SELECT_FIELDS = [
  "id",
  "name",
  "slug",
  "productImage1CloudUrl",
  "altTextProductImage1",
  "price",
  "salePrice",
  "stockQuantity",
  "sku",
];

const PRODUCT_SELECT_FIELDS = parseCsvEnvList(
  "ESPO_PRODUCT_SELECT_FIELDS",
  DEFAULT_PRODUCT_SELECT_FIELDS,
);

/* ------------------------------ Bulk populate ------------------------------ */
const populateRelatedDataBulk = async (
  records,
  entityName,
  populateFields = [],
) => {
  console.log(
    `[populateRelatedDataBulk] Called for ${entityName} with ${records.length} records`,
  );

  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    populateFields.length === 0
  ) {
    return records;
  }

  const collectionConfig = populateFields.find(
    (f) => f.fieldName === "collection",
  );
  const productConfig = populateFields.find((f) => f.fieldName === "product");
  const locationConfig = populateFields.find((f) => f.fieldName === "location");
  const otherConfigs = populateFields.filter(
    (f) =>
      f.fieldName !== "collection" &&
      f.fieldName !== "product" &&
      f.fieldName !== "location",
  );

  let result = [...records];

  if (collectionConfig) {
    result = await attachCollections(result, {
      idField: collectionConfig.idField || "collectionId",
      targetField: "collection",
      collectionEntity: collectionConfig.relatedEntity || "CCollection",
      select: COLLECTION_SELECT_FIELDS,
    });
  }

  if (productConfig) {
    result = await attachCollections(result, {
      idField: productConfig.idField || "productId",
      targetField: "product",
      collectionEntity: productConfig.relatedEntity || "CProduct",
      select: PRODUCT_SELECT_FIELDS,
    });

    // For CProductLocation: also populate collection inside each nested product
    if (entityName === "CProductLocation") {
      const nestedProducts = result.map((r) => r.product).filter(Boolean);
      if (nestedProducts.length > 0) {
        const withCollections = await attachCollections(nestedProducts, {
          idField: "collectionId",
          targetField: "collection",
          collectionEntity: "CCollection",
          select: COLLECTION_SELECT_FIELDS,
        });
        const collectionByProductId = Object.fromEntries(
          withCollections.map((p) => [p.id, p.collection]),
        );
        result = result.map((r) =>
          r.product
            ? { ...r, product: { ...r.product, collection: collectionByProductId[r.product.id] || null } }
            : r,
        );
      }
    }
  }

  if (locationConfig) {
    result = await attachCollections(result, {
      idField: locationConfig.idField || "locationId",
      targetField: "location",
      collectionEntity: locationConfig.relatedEntity || "CLocation",
      select: LOCATION_SELECT_FIELDS,
    });
  }

  if (otherConfigs.length > 0) {
    const entityConfigs = otherConfigs.map((config) => ({
      idField: config.idField || `${config.fieldName}Id`,
      targetField: config.fieldName,
      entityType: config.relatedEntity,
      select:
        config.relatedEntity === "User"
          ? ["id", "name", "userName", "emailAddress"]
          : ["id", "name"],
    }));

    result = await attachRelatedEntities(result, entityConfigs);
  }

  console.log(
    `[populateRelatedDataBulk] Successfully populated ${records.length} records`,
  );
  return result;
};

/* ------------------------------ Populate config ------------------------------ */
const getEntityPopulateConfig = (entityName) => {
  const configs = {
    CProduct: [
      {
        fieldName: "collection",
        relatedEntity: "CCollection",
        idField: "collectionId",
      },
      { fieldName: "account", relatedEntity: "Account", idField: "accountId" },
      { fieldName: "createdBy", relatedEntity: "User", idField: "createdById" },
      {
        fieldName: "modifiedBy",
        relatedEntity: "User",
        idField: "modifiedById",
      },
    ],
    CWishlist: [
      {
        fieldName: "product",
        relatedEntity: "CProduct",
        idField: "productId",
      },
    ],
    CProductLocation: [
      {
        fieldName: "product",
        relatedEntity: "CProduct",
        idField: "productId",
      },
      {
        fieldName: "location",
        relatedEntity: "CLocation",
        idField: "locationId",
      },
    ],
  };

  return configs[entityName] || [];
};

/* ------------------------------ Cloudinary image fields config ------------------------------ */
const getEntityImageFields = (entityName) => {
  const configs = {
    // for 6 other type of cloudnary image
    // ✅ Use EXACT field names from EspoCRM (same as in your database)
    CProduct: ["image1CloudUrl", "image2CloudUrl", "image3CloudUrl"],
    CCollection: ["collectionImage1CloudUrl"],
    CBlog: ["blogimage1CloudURL", "blogimage2CloudURL"],
    CAuthor: ["authorimage"], // ✅ Exact field name from EspoCRM
    CCompanyInformation: ["companyLogoCloudUrl", "companyImageCloudUrl"],
    CSiteSettings: ["siteLogoCloudUrl", "siteImageCloudUrl"],
    CTopicPage: [
      "topicImageCloudUrl",
      "image1CloudUrl",
      "image2CloudUrl",
      "image3CloudUrl",
      "image4CloudUrl",
    ],
    CLocation:["image1CloudUrl"],
    CProductLocation:["image1CloudUrl"],
    // Add your new entity here with EXACT field names:
    // CUser: ["profileImageCloudUrl", "coverImageCloudUrl"],
  };

  return configs[entityName] || [];
};

/* ------------------------------ Apply Cloudinary variants to records ------------------------------ */
const applyCloudinaryToRecords = (records, entityName) => {
  const imageFields = getEntityImageFields(entityName);

  if (imageFields.length === 0 && entityName !== "CProduct") {
    return records;
  }

  const PRODUCT_IMAGE1_FALLBACK = process.env.productfallbackimage1;
  const BLOG_IMAGE1_FALLBACK = process.env.blogfallbackimage1;

  const processRecord = (record) => {
    if (!record || typeof record !== "object") {
      return record;
    }

    // For CProduct, inject fallback for image1CloudUrl if missing
    let recordToProcess = record;
    if (entityName === "CProduct" && !record.image1CloudUrl) {
      recordToProcess = { ...record, image1CloudUrl: PRODUCT_IMAGE1_FALLBACK };
    }
    // For CBlog, inject fallback for blogimage1CloudURL if missing
    if (entityName === "CBlog" && !record.blogimage1CloudURL) {
      recordToProcess = {
        ...recordToProcess,
        blogimage1CloudURL: BLOG_IMAGE1_FALLBACK,
      };
    }

    // Apply Cloudinary to main record
    let processed =
      imageFields.length > 0
        ? applyCloudinaryVariants(recordToProcess, imageFields)
        : { ...recordToProcess };

    // Handle nested collection object for CProduct
    if (entityName === "CProduct" && processed.collection) {
      const collectionImageFields = getEntityImageFields("CCollection");
      processed.collection = applyCloudinaryVariants(
        processed.collection,
        collectionImageFields,
      );
    }

    // Handle nested product + location for CProductLocation
    if (entityName === "CProductLocation") {
      if (processed.product) {
        const productImageFields = getEntityImageFields("CProduct");
        let nestedProduct = processed.product;
        if (!nestedProduct.image1CloudUrl) {
          nestedProduct = { ...nestedProduct, image1CloudUrl: PRODUCT_IMAGE1_FALLBACK };
        }
        nestedProduct = applyCloudinaryVariants(nestedProduct, productImageFields);
        // Also apply collection images inside the nested product
        if (nestedProduct.collection) {
          const collectionImageFields = getEntityImageFields("CCollection");
          nestedProduct.collection = applyCloudinaryVariants(
            nestedProduct.collection,
            collectionImageFields,
          );
        }
        processed.product = nestedProduct;
      }
      if (processed.location) {
        const locationImageFields = getEntityImageFields("CLocation");
        processed.location = applyCloudinaryVariants(
          processed.location,
          locationImageFields,
        );
      }
    }

    return processed;
  };

  if (Array.isArray(records)) {
    return records.map(processRecord);
  } else {
    return processRecord(records);
  }
};

/* ------------------------------ Controller factory ------------------------------ */
const createEntityController = (entityName) => {
  // Get all records
  const getAllRecords = async (req, res) => {
    try {
      const page = intInRange(req.query.page, 1, 1, PUBLIC_API_MAX_PAGE);
      const limit = intInRange(
        req.query.limit,
        PUBLIC_API_DEFAULT_LIMIT,
        1,
        PUBLIC_API_MAX_LIMIT,
      );

      const populate =
        entityName === "CProduct" ||
        entityName === "CWishlist" ||
        entityName === "CProductLocation" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      // ✅ Product special filter: merchTags contains "ecatalogue"
      if (
        entityName.toLowerCase() === "product" ||
        entityName.toLowerCase() === "cproduct"
      ) {
        const data = await fetchEntityPage(entityName, {
          page,
          limit,
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
          where: [
            {
              type: "arrayAnyOf",
              attribute: "merchTags",
              value: ["ecatalogue"],
            },
          ],
        });

        let paginatedRecords = data?.list ?? [];

        if (populate) {
          const populateConfig = getEntityPopulateConfig(entityName);
          paginatedRecords = await populateRelatedDataBulk(
            paginatedRecords,
            entityName,
            populateConfig,
          );
        }

        // ✅ Apply Cloudinary variants
        paginatedRecords = applyCloudinaryToRecords(
          paginatedRecords,
          entityName,
        );

        return res.json({
          success: true,
          data: paginatedRecords,
          total: Math.max(0, data?.total ?? 0),
          entity: entityName,
          filtered: "merchTags arrayAnyOf ecatalogue",
          pagination: {
            page,
            limit,
            totalPages: Math.ceil((data?.total ?? 0) / limit),
          },
        });
      }

      // ✅ Blog filter: status=Approved AND publishedAt<=now
      if (
        entityName.toLowerCase() === "blog" ||
        entityName.toLowerCase() === "cblog"
      ) {
        const data = await fetchEntityPage(entityName, {
          page,
          limit,
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
          where: [
            {
              type: "equals",
              attribute: "status",
              value: "Approved",
            },
            {
              type: "lessThanOrEquals",
              attribute: "publishedAt",
              value: formatEspoDateTime(new Date()),
            },
          ],
        });

        let paginatedRecords = data?.list ?? [];

        if (populate) {
          const populateConfig = getEntityPopulateConfig(entityName);
          paginatedRecords = await populateRelatedDataBulk(
            paginatedRecords,
            entityName,
            populateConfig,
          );
        }

        // ✅ Apply Cloudinary variants
        paginatedRecords = applyCloudinaryToRecords(
          paginatedRecords,
          entityName,
        );

        return res.json({
          success: true,
          data: paginatedRecords,
          total: Math.max(0, data?.total ?? 0),
          entity: entityName,
          filtered: "status=Approved AND publishedAt<=now (EspoCRM where)",
          pagination: {
            page,
            limit,
            totalPages: Math.ceil((data?.total ?? 0) / limit),
          },
        });
      }

      // Default behavior (Espo paginated)
      const data = await fetchEntityPage(entityName, {
        page,
        limit,
        orderBy: req.query.orderBy,
        order: req.query.order,
        select: req.query.select,
      });

      let records = data?.list ?? [];

      if (populate) {
        const populateConfig = getEntityPopulateConfig(entityName);
        records = await populateRelatedDataBulk(
          records,
          entityName,
          populateConfig,
        );
      }

      // ✅ Apply Cloudinary variants
      records = applyCloudinaryToRecords(records, entityName);

      res.json({
        success: true,
        data: records,
        total: Math.max(0, data?.total ?? 0),
        entity: entityName,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil((data?.total ?? 0) / limit),
        },
      });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // Get single record by ID
  const getRecordById = async (req, res) => {
    try {
      const populate =
        entityName === "CProduct" ||
        entityName === "CWishlist" ||
        entityName === "CProductLocation" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      // Check cache first (only if entity should be cached)
      const cacheKey = getCacheKey(entityName, {
        type: "single",
        id: req.params.id,
      });

      let data = getCache(cacheKey, entityName);

      if (!data) {
        data = await espoRequest(`/${entityName}/${req.params.id}`);
        setCache(cacheKey, data, null, entityName);
      }

      let record = data;

      if (populate && record) {
        const populateConfig = getEntityPopulateConfig(entityName);
        const populatedRecords = await populateRelatedDataBulk(
          [record],
          entityName,
          populateConfig,
        );
        record = populatedRecords[0];
      }

      // ✅ Apply Cloudinary variants
      record = applyCloudinaryToRecords(record, entityName);

      res.json({ success: true, data: record, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  const createRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}`, {
        method: "POST",
        body: req.body,
      });

      deleteCacheByEntity(entityName);
      await revalidateFrontends();

      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  const updateRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}/${req.params.id}`, {
        method: "PUT",
        body: req.body,
      });

      deleteCacheByEntity(entityName);
      await revalidateFrontends();

      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  const deleteRecord = async (req, res) => {
    try {
      await espoRequest(`/${entityName}/${req.params.id}`, {
        method: "DELETE",
      });

      deleteCacheByEntity(entityName);
      await revalidateFrontends();

      res.json({ success: true, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // ✅ Get records by field value (NOW scans ALL records + loose compare)
  const getRecordsByFieldValue = async (req, res) => {
    const { fieldName, fieldValue } = req.params;

    try {
      if (!fieldName || !fieldValue) {
        return res.status(400).json({
          success: false,
          error: "Both fieldName and fieldValue parameters are required",
        });
      }

      const page = intInRange(req.query.page, 1, 1, PUBLIC_API_MAX_PAGE);
      const limit = intInRange(
        req.query.limit,
        PUBLIC_API_DEFAULT_LIMIT,
        1,
        PUBLIC_API_MAX_LIMIT,
      );
      const offset = (page - 1) * limit;

      const populate =
        entityName === "CProduct" ||
        entityName === "CWishlist" ||
        entityName === "CProductLocation" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      // fetch ALL (paged) instead of maxSize:100
      const data = await fetchAllRecords(entityName, {
        orderBy: req.query.orderBy,
        order: req.query.order,
        select: req.query.select,
      });

      const filteredRecords = (data?.list ?? []).filter((record) => {
        const v = record[fieldName];
        if (v === null || v === undefined) return false;

        if (Array.isArray(v)) {
          return v.some((item) => eqLoose(item, fieldValue));
        }

        // strings/numbers/booleans
        return eqLoose(v, fieldValue);
      });

      const paginatedRecordsRaw = filteredRecords.slice(offset, offset + limit);
      let paginatedRecords = paginatedRecordsRaw;

      if (populate) {
        const populateConfig = getEntityPopulateConfig(entityName);
        paginatedRecords = await populateRelatedDataBulk(
          paginatedRecords,
          entityName,
          populateConfig,
        );
      }

      // ✅ Apply Cloudinary variants
      paginatedRecords = applyCloudinaryToRecords(paginatedRecords, entityName);

      res.json({
        success: true,
        data: paginatedRecords,
        total: filteredRecords.length,
        entity: entityName,
        field: fieldName,
        value: fieldValue,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(filteredRecords.length / limit),
        },
      });
    } catch (e) {
      console.error(
        `[getRecordsByFieldValue] Error for ${entityName}/${req.params.fieldName}/${req.params.fieldValue}:`,
        { status: e.status, message: e.message, data: e.data },
      );
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
        details: e.data,
      });
    }
  };

  // ✅ Unique values (NOW scans ALL records)
  const getUniqueFieldValues = async (req, res) => {
    try {
      const { fieldName } = req.params;

      if (!fieldName) {
        return res.status(400).json({
          success: false,
          error: "fieldName parameter is required",
        });
      }

      const data = await fetchAllRecords(entityName, {
        select: fieldName,
      });

      const uniqueValues = new Set();

      (data?.list ?? []).forEach((record) => {
        const fieldValue = record[fieldName];

        if (fieldValue !== null && fieldValue !== undefined) {
          if (Array.isArray(fieldValue)) {
            fieldValue.forEach((item) => {
              const t = cleanStr(item);
              if (t) uniqueValues.add(t);
            });
          } else {
            const t = cleanStr(fieldValue);
            if (t && t !== "N/A") uniqueValues.add(t);
          }
        }
      });

      const sortedValues = Array.from(uniqueValues).sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
      });

      res.json({
        success: true,
        entity: entityName,
        field: fieldName,
        values: sortedValues,
        total: sortedValues.length,
      });
    } catch (e) {
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
      });
    }
  };

  // ✅ Search products (NOW scans ALL + loose includes)
  const getBySearchProduct = async (req, res) => {
    try {
      const { searchValue } = req.params;

      if (!searchValue) {
        return res.status(400).json({
          success: false,
          error: "searchValue parameter is required",
        });
      }

      const page = intInRange(req.query.page, 1, 1, PUBLIC_API_MAX_PAGE);
      const limit = intInRange(
        req.query.limit,
        PUBLIC_API_DEFAULT_LIMIT,
        1,
        PUBLIC_API_MAX_LIMIT,
      );
      const offset = (page - 1) * limit;

      const searchTerm = normText(searchValue);

      const data = await fetchAllRecords(entityName, {
        orderBy: req.query.orderBy,
        order: req.query.order,
        select: req.query.select,
      });

      let records = data?.list ?? [];

      // if product: keep your ecatalogue-only logic
      if (
        entityName.toLowerCase() === "product" ||
        entityName.toLowerCase() === "cproduct"
      ) {
        records = records.filter((record) => {
          const merchTags = record.merchTags;
          if (!merchTags || !Array.isArray(merchTags)) return false;
          return merchTags.some((tag) => eqLoose(tag, "ecatalogue"));
        });
      }

      const filteredRecords = records.filter((record) => {
        const keywords = record.keywords;
        const productTitle = record.productTitle;
        const name = record.name;

        let keywordsMatch = false;
        if (keywords && Array.isArray(keywords)) {
          keywordsMatch = keywords.some((k) => includesLoose(k, searchTerm));
        }

        const titleMatch = productTitle
          ? includesLoose(productTitle, searchTerm)
          : false;
        const nameMatch = name ? includesLoose(name, searchTerm) : false;

        return keywordsMatch || titleMatch || nameMatch;
      });

      const paginatedRecordsRaw = filteredRecords.slice(offset, offset + limit);
      let paginatedRecords = paginatedRecordsRaw;

      const populateConfig = getEntityPopulateConfig(entityName);
      paginatedRecords = await populateRelatedDataBulk(
        paginatedRecords,
        entityName,
        populateConfig,
      );

      // ✅ Apply Cloudinary variants
      paginatedRecords = applyCloudinaryToRecords(paginatedRecords, entityName);

      return res.json({
        success: true,
        data: paginatedRecords,
        total: filteredRecords.length,
        entity: entityName,
        searchValue,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(filteredRecords.length / limit),
        },
      });
    } catch (e) {
      console.error(
        `[getBySearchProduct] Error searching for "${req.params.searchValue}" in ${entityName}:`,
        {
          status: e.status,
          message: e.message,
          data: e.data,
          url: e.url || "unknown",
        },
      );
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
        searchValue: req.params.searchValue,
        entity: entityName,
      });
    }
  };

  return {
    getAllRecords,
    getRecordById,
    createRecord,
    updateRecord,
    deleteRecord,
    getRecordsByFieldValue,
    getUniqueFieldValues,
    getBySearchProduct,
  };
};

/* ------------------------------ Dynamic Section (Standalone) ------------------------------ */
// ✅ Dynamic section: search by merchtag in TopicPage.slug and Product.merchTags
const getDynamicSection = async (req, res) => {
  try {
    const { merchtag } = req.params;

    if (!merchtag) {
      return res.status(400).json({
        success: false,
        error: "merchtag parameter is required",
      });
    }

    const merchtagValue = cleanStr(merchtag);

    // Fetch matching TopicPage records directly from EspoCRM
    const topicPageData = await fetchRecordsPaged("CTopicPage", {
      orderBy: req.query.orderBy,
      order: req.query.order,
      where: [
        {
          type: "equals",
          attribute: "slug",
          value: merchtagValue,
        },
      ],
    });

    // Fetch matching Product records directly from EspoCRM
    const productData = await fetchRecordsPaged("CProduct", {
      orderBy: req.query.orderBy,
      order: req.query.order,
      where: [
        {
          type: "arrayAnyOf",
          attribute: "merchTags",
          value: [merchtagValue],
        },
      ],
    });

    let matchingTopicPages = topicPageData?.list ?? [];
    let matchingProducts = productData?.list ?? [];

    if (matchingTopicPages.length === 0) {
      const fallbackTopicPages = await fetchAllRecords("CTopicPage", {
        orderBy: req.query.orderBy,
        order: req.query.order,
      });

      matchingTopicPages = (fallbackTopicPages?.list ?? []).filter((record) =>
        eqLoose(record?.slug, merchtagValue),
      );
    }

    if (matchingProducts.length === 0) {
      const fallbackProducts = await fetchAllRecords("CProduct", {
        orderBy: req.query.orderBy,
        order: req.query.order,
      });

      matchingProducts = (fallbackProducts?.list ?? []).filter((record) =>
        Array.isArray(record?.merchTags) &&
        record.merchTags.some((tag) => eqLoose(tag, merchtagValue)),
      );
    }

    // Populate related data for products
    if (matchingProducts.length > 0) {
      const populateConfig = getEntityPopulateConfig("CProduct");
      matchingProducts = await populateRelatedDataBulk(
        matchingProducts,
        "CProduct",
        populateConfig,
      );
    }

    // Apply Cloudinary variants
    const processedTopicPages = applyCloudinaryToRecords(
      matchingTopicPages,
      "CTopicPage",
    );
    const processedProducts = applyCloudinaryToRecords(
      matchingProducts,
      "CProduct",
    );

    // Return combined results
    res.json({
      success: true,
      merchtag,
      data: {
        topicPages: processedTopicPages,
        products: processedProducts,
      },
      counts: {
        topicPages: processedTopicPages.length,
        products: processedProducts.length,
        total: processedTopicPages.length + processedProducts.length,
      },
    });
  } catch (e) {
    console.error(
      `[getDynamicSection] Error searching for merchtag "${req.params.merchtag}":`,
      {
        status: e.status,
        message: e.message,
        data: e.data,
      },
    );
    res.status(e.status || 500).json({
      success: false,
      error: e.data || e.message,
      merchtag: req.params.merchtag,
    });
  }
};

// ✅ Get all dynamic sections: return only section names where TopicPage.slug matches any Product.merchTags
const getAllDynamicSections = async (req, res) => {
  try {
    // Fetch all TopicPage records
    const topicPageData = await fetchAllRecords("CTopicPage", {
      orderBy: req.query.orderBy,
      order: req.query.order,
      select: "slug",
    });

    // Fetch all Product records
    const productData = await fetchAllRecords("CProduct", {
      orderBy: req.query.orderBy,
      order: req.query.order,
      select: "merchTags",
    });

    const allTopicPages = topicPageData?.list ?? [];
    const allProducts = productData?.list ?? [];

    // Create a set of all TopicPage slugs (normalized)
    const topicPageSlugs = new Map();
    allTopicPages.forEach((tp) => {
      const slug = cleanStr(tp.slug);
      if (slug) {
        const normalizedSlug = normText(slug);
        if (!topicPageSlugs.has(normalizedSlug)) {
          topicPageSlugs.set(normalizedSlug, slug);
        }
      }
    });

    // Find all matching values (slugs that exist in both TopicPage.slug and Product.merchTags)
    const matchingValues = new Set();
    allProducts.forEach((product) => {
      const merchTags = product.merchTags;
      if (merchTags && Array.isArray(merchTags)) {
        merchTags.forEach((tag) => {
          const normalizedTag = normText(tag);
          const topicSlug = topicPageSlugs.get(normalizedTag);
          if (topicSlug) {
            matchingValues.add(topicSlug);
          }
        });
      }
    });

    // Convert to array and sort
    const sectionNames = Array.from(matchingValues).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );

    // Return only section names
    res.json({
      success: true,
      totalSections: sectionNames.length,
      sections: sectionNames,
    });
  } catch (e) {
    console.error("[getAllDynamicSections] Error:", {
      status: e.status,
      message: e.message,
      data: e.data,
    });
    res.status(e.status || 500).json({
      success: false,
      error: e.data || e.message,
    });
  }
};

module.exports = {
  createEntityController,
  getDynamicSection,
  getAllDynamicSections,
  fetchAllRecords,
};
