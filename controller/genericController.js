const { espoRequest } = require("./espoClient");
const { attachCollections, attachRelatedEntities } = require("../utils/espo");

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
// Fetch ALL records for list endpoints (safe for 120 records; scalable)
async function fetchAllRecords(entityName, { orderBy, order, select } = {}) {
  const pageSize = Number(process.env.ESPO_LIST_PAGE_SIZE || 200);
  const maxTotal = Number(process.env.ESPO_LIST_MAX_TOTAL || 5000);

  let offset = 0;
  let all = [];
  let total = null;

  while (true) {
    const query = {
      maxSize: pageSize,
      offset,
    };

    if (orderBy) query.orderBy = orderBy;
    if (order) query.order = order;
    if (select) query.select = select;

    const data = await espoRequest(`/${entityName}`, { query });

    const list = data?.list ?? [];
    const t = typeof data?.total === "number" ? data.total : null;

    if (total === null && t !== null) total = t;

    all = all.concat(list);
    offset += list.length;

    // stop conditions
    if (list.length === 0) break;
    if (total !== null && offset >= total) break;
    if (all.length >= maxTotal) break; // safety cap
    if (list.length < pageSize) break;
  }

  return {
    list: all,
    total: total !== null ? total : all.length,
  };
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
  DEFAULT_COLLECTION_SELECT_FIELDS
);

/* ------------------------------ Bulk populate ------------------------------ */
const populateRelatedDataBulk = async (records, entityName, populateFields = []) => {
  console.log(
    `[populateRelatedDataBulk] Called for ${entityName} with ${records.length} records`
  );

  if (!Array.isArray(records) || records.length === 0 || populateFields.length === 0) {
    return records;
  }

  const collectionConfig = populateFields.find((f) => f.fieldName === "collection");
  const otherConfigs = populateFields.filter((f) => f.fieldName !== "collection");

  let result = [...records];

  if (collectionConfig) {
    result = await attachCollections(result, {
      idField: collectionConfig.idField || "collectionId",
      targetField: "collection",
      collectionEntity: collectionConfig.relatedEntity || "CCollection",
      select: COLLECTION_SELECT_FIELDS,
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
    `[populateRelatedDataBulk] Successfully populated ${records.length} records`
  );
  return result;
};

const populateRelatedData = async (records, entityName, populateFields = []) => {
  console.warn(
    "[DEPRECATED] Using old populateRelatedData - consider switching to populateRelatedDataBulk"
  );
  return populateRelatedDataBulk(records, entityName, populateFields);
};

/* ------------------------------ Populate config ------------------------------ */
const getEntityPopulateConfig = (entityName) => {
  const configs = {
    CProduct: [
      { fieldName: "collection", relatedEntity: "CCollection", idField: "collectionId" },
      { fieldName: "account", relatedEntity: "Account", idField: "accountId" },
      { fieldName: "createdBy", relatedEntity: "User", idField: "createdById" },
      { fieldName: "modifiedBy", relatedEntity: "User", idField: "modifiedById" },
    ],
  };

  return configs[entityName] || [];
};

/* ------------------------------ Controller factory ------------------------------ */
const createEntityController = (entityName) => {
  // Get all records
  const getAllRecords = async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;

      const populate =
        entityName === "CProduct" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      // ✅ Product special filter: merchTags contains "ecatalogue"
      if (
        entityName.toLowerCase() === "product" ||
        entityName.toLowerCase() === "cproduct"
      ) {
        // fetch ALL (paged) instead of only 200
        const data = await fetchAllRecords(entityName, {
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
        });

        const filteredRecords = (data?.list ?? []).filter((record) => {
          const merchTags = record.merchTags;
          if (!merchTags || !Array.isArray(merchTags)) return false;
          return merchTags.some((tag) => eqLoose(tag, "ecatalogue"));
        });

        const paginatedRecordsRaw = filteredRecords.slice(offset, offset + limit);
        let paginatedRecords = paginatedRecordsRaw;

        if (populate) {
          const populateConfig = getEntityPopulateConfig(entityName);
          paginatedRecords = await populateRelatedDataBulk(
            paginatedRecords,
            entityName,
            populateConfig
          );
        }

        return res.json({
          success: true,
          data: paginatedRecords,
          total: filteredRecords.length,
          entity: entityName,
          filtered: "merchTags contains ecatalogue",
          pagination: {
            page,
            limit,
            totalPages: Math.ceil(filteredRecords.length / limit),
          },
        });
      }

      // ✅ Blog filter: status=Approved AND publishedAt<=now
      if (
        entityName.toLowerCase() === "blog" ||
        entityName.toLowerCase() === "cblog"
      ) {
        const data = await fetchAllRecords(entityName, {
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
        });

        const now = new Date();

        const parseEspoDate = (v) => {
          if (!v) return null;
          if (v instanceof Date) return v;

          const s = String(v).trim();
          if (!s) return null;

          let iso = s.includes("T") ? s : s.replace(" ", "T");
          if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso = `${iso}T00:00:00`;

          if (!/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) iso += "Z";

          const d = new Date(iso);
          return Number.isNaN(d.getTime()) ? null : d;
        };

        const filteredRecords = (data?.list ?? []).filter((record) => {
          const status = normText(record.status ?? "");
          if (status !== "approved") return false;

          const pub = parseEspoDate(record.publishedAt);
          if (!pub) return false;

          return pub.getTime() <= now.getTime();
        });

        const paginatedRecordsRaw = filteredRecords.slice(offset, offset + limit);
        let paginatedRecords = paginatedRecordsRaw;

        if (populate) {
          const populateConfig = getEntityPopulateConfig(entityName);
          paginatedRecords = await populateRelatedDataBulk(
            paginatedRecords,
            entityName,
            populateConfig
          );
        }

        return res.json({
          success: true,
          data: paginatedRecords,
          total: filteredRecords.length,
          entity: entityName,
          filtered: "status=Approved AND publishedAt<=now",
          pagination: {
            page,
            limit,
            totalPages: Math.ceil(filteredRecords.length / limit),
          },
        });
      }

      // Default behavior (Espo paginated)
      const data = await espoRequest(`/${entityName}`, {
        query: {
          maxSize: limit,
          offset,
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
        },
      });

      let records = data?.list ?? [];

      if (populate) {
        const populateConfig = getEntityPopulateConfig(entityName);
        records = await populateRelatedDataBulk(records, entityName, populateConfig);
      }

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
      res.status(e.status || 500).json({ success: false, error: e.data || e.message });
    }
  };

  // Get single record by ID
  const getRecordById = async (req, res) => {
    try {
      const populate =
        entityName === "CProduct" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      const data = await espoRequest(`/${entityName}/${req.params.id}`);
      let record = data;

      if (populate && record) {
        const populateConfig = getEntityPopulateConfig(entityName);
        const populatedRecords = await populateRelatedDataBulk(
          [record],
          entityName,
          populateConfig
        );
        record = populatedRecords[0];
      }

      res.json({ success: true, data: record, entity: entityName });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.data || e.message });
    }
  };

  const createRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}`, {
        method: "POST",
        body: req.body,
      });
      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.data || e.message });
    }
  };

  const updateRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}/${req.params.id}`, {
        method: "PUT",
        body: req.body,
      });
      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.data || e.message });
    }
  };

  const deleteRecord = async (req, res) => {
    try {
      await espoRequest(`/${entityName}/${req.params.id}`, { method: "DELETE" });
      res.json({ success: true, entity: entityName });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.data || e.message });
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

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;

      const populate =
        entityName === "CProduct" ||
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
          populateConfig
        );
      }

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
        { status: e.status, message: e.message, data: e.data }
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

      const data = await fetchAllRecords(entityName);

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

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
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

        const titleMatch = productTitle ? includesLoose(productTitle, searchTerm) : false;
        const nameMatch = name ? includesLoose(name, searchTerm) : false;

        return keywordsMatch || titleMatch || nameMatch;
      });

      const paginatedRecordsRaw = filteredRecords.slice(offset, offset + limit);
      let paginatedRecords = paginatedRecordsRaw;

      const populateConfig = getEntityPopulateConfig(entityName);
      paginatedRecords = await populateRelatedDataBulk(
        paginatedRecords,
        entityName,
        populateConfig
      );

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
        { status: e.status, message: e.message, data: e.data, url: e.url || "unknown" }
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

module.exports = { createEntityController };
