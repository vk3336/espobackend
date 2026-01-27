const { espoRequest } = require("./espoClient");
const { attachCollections, attachRelatedEntities } = require("../utils/espo");

/* ------------------------------ ENV helpers (NEW) ------------------------------ */
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

  // remove duplicates while preserving order
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

// Default fallback fields if env not set
const DEFAULT_COLLECTION_SELECT_FIELDS = [
  "id",
  "name",
  "slug",
  "collectionImage1CloudUrl",
  "altTextCollectionImage1",
  "collectionvideoURL",
  "collectionaltTextVideo",
];

// ✅ Collection fields now fully controlled by .env
const COLLECTION_SELECT_FIELDS = parseCsvEnvList(
  "ESPO_COLLECTION_SELECT_FIELDS",
  DEFAULT_COLLECTION_SELECT_FIELDS
);

// NEW: Bulk populate using EspoCRM's "in" operator - much faster!
const populateRelatedDataBulk = async (records, entityName, populateFields = []) => {
  console.log(
    `[populateRelatedDataBulk] Called for ${entityName} with ${records.length} records`
  );

  if (!Array.isArray(records) || records.length === 0 || populateFields.length === 0) {
    return records;
  }

  // Separate collection from other entities for optimized handling
  const collectionConfig = populateFields.find((f) => f.fieldName === "collection");
  const otherConfigs = populateFields.filter((f) => f.fieldName !== "collection");

  let result = [...records];

  // ✅ Handle collections with fields driven by env
  if (collectionConfig) {
    result = await attachCollections(result, {
      idField: collectionConfig.idField || "collectionId",
      targetField: "collection",
      collectionEntity: collectionConfig.relatedEntity || "CCollection",
      select: COLLECTION_SELECT_FIELDS, // ✅ dynamic from .env
    });
  }

  // Handle other entities (accounts, users, etc.) in bulk
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

// LEGACY: Keep old function for backward compatibility (but mark as deprecated)
const populateRelatedData = async (records, entityName, populateFields = []) => {
  console.warn(
    "[DEPRECATED] Using old populateRelatedData - consider switching to populateRelatedDataBulk"
  );

  // For now, just call the new bulk function
  return populateRelatedDataBulk(records, entityName, populateFields);
};

// Configuration for entity relationships
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
    // Add more entity configurations as needed
  };

  return configs[entityName] || [];
};

// Generic controller factory that creates CRUD operations for any entity
const createEntityController = (entityName) => {
  // Get all records
  const getAllRecords = async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;

      // Always populate for CProduct, otherwise check query parameter
      const populate =
        entityName === "CProduct" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      // Special filtering for product entity - filter by merchTags containing "ecatalogue"
      if (
        entityName.toLowerCase() === "product" ||
        entityName.toLowerCase() === "cproduct"
      ) {
        // Get more records to filter through
        const data = await espoRequest(`/${entityName}`, {
          query: {
            maxSize: 200, // Get more records to filter through
            offset: 0,
            orderBy: req.query.orderBy,
            order: req.query.order,
            select: req.query.select,
          },
        });

        // Filter products that have "ecatalogue" in merchTags
        const filteredRecords = (data?.list ?? []).filter((record) => {
          const merchTags = record.merchTags;
          if (!merchTags || !Array.isArray(merchTags)) return false;

          return merchTags.some(
            (tag) => tag && tag.toString().toLowerCase() === "ecatalogue"
          );
        });

        // Apply pagination to filtered results
        const startIndex = offset;
        const endIndex = startIndex + limit;
        let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

        // Populate related data if requested or if CProduct
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
        });
      }

      // ✅ Special filtering for blog entity
      // condition:
      // 1) status must be Approved
      // 2) publishedAt must be <= now (past or current). future dates and null must not come
      if (
        entityName.toLowerCase() === "blog" ||
        entityName.toLowerCase() === "cblog"
      ) {
        // Get more records to filter through (same approach like product)
        const data = await espoRequest(`/${entityName}`, {
          query: {
            maxSize: 200,
            offset: 0,
            orderBy: req.query.orderBy,
            order: req.query.order,
            select: req.query.select,
          },
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
          const status = (record.status ?? "").toString().toLowerCase();
          if (status !== "approved") return false;

          const pub = parseEspoDate(record.publishedAt);
          if (!pub) return false;

          return pub.getTime() <= now.getTime();
        });

        const startIndex = offset;
        const endIndex = startIndex + limit;
        let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

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
        });
      }

      // Default behavior for all other entities
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
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // Create new record
  const createRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}`, {
        method: "POST",
        body: req.body,
      });
      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // Update record by ID
  const updateRecord = async (req, res) => {
    try {
      const data = await espoRequest(`/${entityName}/${req.params.id}`, {
        method: "PUT",
        body: req.body,
      });
      res.json({ success: true, data, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // Delete record by ID
  const deleteRecord = async (req, res) => {
    try {
      await espoRequest(`/${entityName}/${req.params.id}`, {
        method: "DELETE",
      });
      res.json({ success: true, entity: entityName });
    } catch (e) {
      res
        .status(e.status || 500)
        .json({ success: false, error: e.data || e.message });
    }
  };

  // Get records by field value (for array fields like tags)
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

      const queryParams = {
        maxSize: 100,
        offset: 0,
      };

      if (req.query.orderBy) {
        queryParams.orderBy = req.query.orderBy;
        queryParams.order = req.query.order || "desc";
      }

      if (req.query.select) {
        queryParams.select = req.query.select;
      }

      const data = await espoRequest(`/${entityName}`, {
        query: queryParams,
      });

      const filteredRecords = (data?.list ?? []).filter((record) => {
        const recordFieldValue = record[fieldName];
        if (!recordFieldValue) return false;

        if (Array.isArray(recordFieldValue)) {
          return recordFieldValue.some(
            (item) =>
              item &&
              item.toString().trim().toLowerCase() === fieldValue.toLowerCase()
          );
        } else if (typeof recordFieldValue === "string") {
          return recordFieldValue.trim().toLowerCase() === fieldValue.toLowerCase();
        } else {
          return (
            recordFieldValue.toString().toLowerCase() === fieldValue.toLowerCase()
          );
        }
      });

      const startIndex = offset;
      const endIndex = startIndex + limit;
      let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

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
        {
          status: e.status,
          message: e.message,
          data: e.data,
        }
      );
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
        details: e.data,
      });
    }
  };

  // Get unique values for any field
  const getUniqueFieldValues = async (req, res) => {
    try {
      const { fieldName } = req.params;

      if (!fieldName) {
        return res.status(400).json({
          success: false,
          error: "fieldName parameter is required",
        });
      }

      const data = await espoRequest(`/${entityName}`, {
        query: {
          maxSize: 100,
          offset: 0,
        },
      });

      const uniqueValues = new Set();

      (data?.list ?? []).forEach((record) => {
        const fieldValue = record[fieldName];

        if (fieldValue !== null && fieldValue !== undefined) {
          if (Array.isArray(fieldValue)) {
            fieldValue.forEach((item) => {
              if (item && item.toString().trim() !== "") {
                uniqueValues.add(item.toString().trim());
              }
            });
          } else if (typeof fieldValue === "string") {
            const trimmedValue = fieldValue.trim();
            if (trimmedValue !== "" && trimmedValue !== "N/A") {
              uniqueValues.add(trimmedValue);
            }
          } else if (typeof fieldValue === "number") {
            uniqueValues.add(fieldValue.toString());
          } else if (typeof fieldValue === "boolean") {
            uniqueValues.add(fieldValue.toString());
          }
        }
      });

      const sortedValues = Array.from(uniqueValues).sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
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

  // Search products by keywords or productTitle
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

      console.log(
        `[getBySearchProduct] Searching for: "${searchValue}" in entity: ${entityName}`
      );

      if (
        entityName.toLowerCase() === "product" ||
        entityName.toLowerCase() === "cproduct"
      ) {
        const data = await espoRequest(`/${entityName}`, {
          query: {
            maxSize: 200,
            offset: 0,
            orderBy: req.query.orderBy,
            order: req.query.order,
            select: req.query.select,
          },
        });

        const ecatalogueProducts = (data?.list ?? []).filter((record) => {
          const merchTags = record.merchTags;
          if (!merchTags || !Array.isArray(merchTags)) return false;
          return merchTags.some(
            (tag) => tag && tag.toString().toLowerCase() === "ecatalogue"
          );
        });

        const filteredRecords = ecatalogueProducts.filter((record) => {
          const keywords = record.keywords;
          const productTitle = record.productTitle;
          const name = record.name;
          const searchTerm = searchValue.toLowerCase().trim();

          let keywordsMatch = false;
          if (keywords && Array.isArray(keywords)) {
            keywordsMatch = keywords.some(
              (keyword) =>
                keyword && keyword.toString().toLowerCase().includes(searchTerm)
            );
          }

          let titleMatch = false;
          if (productTitle && typeof productTitle === "string") {
            titleMatch = productTitle.toLowerCase().includes(searchTerm);
          }

          let nameMatch = false;
          if (name && typeof name === "string") {
            nameMatch = name.toLowerCase().includes(searchTerm);
          }

          return keywordsMatch || titleMatch || nameMatch;
        });

        const startIndex = offset;
        const endIndex = startIndex + limit;
        let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

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
          searchValue: searchValue,
          filtered: "merchTags contains ecatalogue AND search term",
          pagination: {
            page,
            limit,
            totalPages: Math.ceil(filteredRecords.length / limit),
          },
        });
      } else {
        const data = await espoRequest(`/${entityName}`, {
          query: {
            maxSize: 200,
            offset: 0,
            orderBy: req.query.orderBy || "createdAt",
            order: req.query.order || "desc",
          },
        });

        const filteredRecords = (data?.list ?? []).filter((record) => {
          const keywords = record.keywords;
          const productTitle = record.productTitle;
          const name = record.name;
          const searchTerm = searchValue.toLowerCase().trim();

          let keywordsMatch = false;
          if (keywords && Array.isArray(keywords)) {
            keywordsMatch = keywords.some(
              (keyword) =>
                keyword && keyword.toString().toLowerCase().includes(searchTerm)
            );
          }

          let titleMatch = false;
          if (productTitle && typeof productTitle === "string") {
            titleMatch = productTitle.toLowerCase().includes(searchTerm);
          }

          let nameMatch = false;
          if (name && typeof name === "string") {
            nameMatch = name.toLowerCase().includes(searchTerm);
          }

          return keywordsMatch || titleMatch || nameMatch;
        });

        const startIndex = offset;
        const endIndex = startIndex + limit;
        let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

        const populateConfig = getEntityPopulateConfig(entityName);
        paginatedRecords = await populateRelatedDataBulk(
          paginatedRecords,
          entityName,
          populateConfig
        );

        res.json({
          success: true,
          data: paginatedRecords,
          total: filteredRecords.length,
          entity: entityName,
          searchValue: searchValue,
          pagination: {
            page,
            limit,
            totalPages: Math.ceil(filteredRecords.length / limit),
          },
        });
      }
    } catch (e) {
      console.error(
        `[getBySearchProduct] Error searching for "${req.params.searchValue}" in ${entityName}:`,
        {
          status: e.status,
          message: e.message,
          data: e.data,
          url: e.url || "unknown",
        }
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
