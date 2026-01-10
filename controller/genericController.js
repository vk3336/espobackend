const { espoRequest } = require("./espoClient");

// Helper function to populate related entity data with controlled concurrency
const populateRelatedData = async (
  records,
  entityName,
  populateFields = []
) => {
  console.log(
    `[populateRelatedData] Called for ${entityName} with ${records.length} records and ${populateFields.length} populate fields`
  );

  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    populateFields.length === 0
  ) {
    console.log(
      `[populateRelatedData] Early return - no records or populate fields`
    );
    return records;
  }

  // Process records in batches to avoid overwhelming the server
  const batchSize = parseInt(process.env.POPULATE_BATCH_SIZE) || 3;
  const batchDelay = parseInt(process.env.POPULATE_BATCH_DELAY_MS) || 100;
  const populatedRecords = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (record) => {
        const populatedRecord = { ...record };

        // Process populate fields sequentially for each record to avoid too many concurrent requests
        for (const field of populateFields) {
          const {
            fieldName,
            relatedEntity,
            idField = `${fieldName}Id`,
          } = field;

          console.log(
            `[populateRelatedData] Processing field: ${fieldName}, idField: ${idField}, relatedEntity: ${relatedEntity}, recordId: ${record[idField]}`
          );

          if (record[idField]) {
            try {
              const relatedData = await espoRequest(
                `/${relatedEntity}/${record[idField]}`
              );
              populatedRecord[fieldName] = relatedData;
              console.log(
                `[populateRelatedData] Successfully populated ${fieldName} for record ${record.id}`
              );
            } catch (error) {
              console.warn(
                `Failed to populate ${fieldName} for record ${record.id}:`,
                error.message
              );
              populatedRecord[fieldName] = null;
            }
          }
        }

        return populatedRecord;
      })
    );

    populatedRecords.push(...batchResults);

    // Small delay between batches to prevent overwhelming the server
    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, batchDelay));
    }
  }

  return populatedRecords;
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

      // Populate related data if requested or if CProduct
      if (populate) {
        const populateConfig = getEntityPopulateConfig(entityName);
        records = await populateRelatedData(
          records,
          entityName,
          populateConfig
        );
      }

      res.json({
        success: true,
        data: records,
        total: Math.max(0, data?.total ?? 0), // Ensure total is not negative
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
      // Always populate for CProduct, otherwise check query parameter
      const populate =
        entityName === "CProduct" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      const data = await espoRequest(`/${entityName}/${req.params.id}`);

      let record = data;

      // Populate related data if requested or if CProduct
      if (populate && record) {
        const populateConfig = getEntityPopulateConfig(entityName);
        const populatedRecords = await populateRelatedData(
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
      // Always populate for CProduct, otherwise check query parameter
      const populate =
        entityName === "CProduct" ||
        req.query.populate === "true" ||
        req.query.populate === "1";

      const queryParams = {
        maxSize: 100,
        offset: 0,
      };

      // Only add orderBy if explicitly provided, avoid defaults for special entities like CSiteSettings
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
          return (
            recordFieldValue.trim().toLowerCase() === fieldValue.toLowerCase()
          );
        } else {
          return (
            recordFieldValue.toString().toLowerCase() ===
            fieldValue.toLowerCase()
          );
        }
      });

      const startIndex = offset;
      const endIndex = startIndex + limit;
      let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

      // Populate related data if requested or if CProduct
      if (populate) {
        const populateConfig = getEntityPopulateConfig(entityName);
        paginatedRecords = await populateRelatedData(
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
        `[getRecordsByFieldValue] Error for ${entityName}/${fieldName}/${fieldValue}:`,
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

      // Get all products first
      const data = await espoRequest(`/${entityName}`, {
        query: {
          maxSize: 200, // Get more records to search through
          offset: 0,
          orderBy: req.query.orderBy || "createdAt",
          order: req.query.order || "desc",
        },
      });

      // Filter products that match searchValue in keywords or productTitle
      const filteredRecords = (data?.list ?? []).filter((record) => {
        const keywords = record.keywords;
        const productTitle = record.productTitle;
        const searchTerm = searchValue.toLowerCase().trim();

        // Check if searchValue matches keywords (array field)
        let keywordsMatch = false;
        if (keywords && Array.isArray(keywords)) {
          keywordsMatch = keywords.some(
            (keyword) =>
              keyword && keyword.toString().toLowerCase().includes(searchTerm)
          );
        }

        // Check if searchValue matches productTitle (string field)
        let titleMatch = false;
        if (productTitle && typeof productTitle === "string") {
          titleMatch = productTitle.toLowerCase().includes(searchTerm);
        }

        return keywordsMatch || titleMatch;
      });

      // Apply pagination to filtered results
      const startIndex = offset;
      const endIndex = startIndex + limit;
      let paginatedRecords = filteredRecords.slice(startIndex, endIndex);

      // Always populate for product search results
      const populateConfig = getEntityPopulateConfig(entityName);
      paginatedRecords = await populateRelatedData(
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
    } catch (e) {
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
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
