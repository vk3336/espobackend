const { espoRequest } = require("./espoClient");

// Generic controller factory that creates CRUD operations for any entity
const createEntityController = (entityName) => {
  // Get all records
  const getAllRecords = async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;

      const data = await espoRequest(`/${entityName}`, {
        query: {
          maxSize: limit,
          offset,
          orderBy: req.query.orderBy,
          order: req.query.order,
          select: req.query.select,
        },
      });

      res.json({
        success: true,
        data: data?.list ?? [],
        total: data?.total ?? 0,
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
      const data = await espoRequest(`/${entityName}/${req.params.id}`);
      res.json({ success: true, data, entity: entityName });
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
    try {
      const { fieldName, fieldValue } = req.params;

      if (!fieldName || !fieldValue) {
        return res.status(400).json({
          success: false,
          error: "Both fieldName and fieldValue parameters are required",
        });
      }

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;

      const data = await espoRequest(`/${entityName}`, {
        query: {
          maxSize: 100,
          offset: 0,
          orderBy: req.query.orderBy || "createdAt",
          order: req.query.order || "desc",
          select: req.query.select,
        },
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
      const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

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
      res.status(e.status || 500).json({
        success: false,
        error: e.data || e.message,
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

  return {
    getAllRecords,
    getRecordById,
    createRecord,
    updateRecord,
    deleteRecord,
    getRecordsByFieldValue,
    getUniqueFieldValues,
  };
};

module.exports = { createEntityController };
