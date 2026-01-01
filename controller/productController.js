const { espoRequest } = require("./espoClient");

const ENTITY = process.env.ESPO_PRODUCT_ENTITY || "CProduct";

// Get all products
const getAllProducts = async (req, res) => {
  try {
    // optional: map your frontend params to Espo params
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const offset = (page - 1) * limit;

    const data = await espoRequest(`/${ENTITY}`, {
      query: {
        maxSize: limit,
        offset,
        orderBy: req.query.orderBy, // e.g. "createdAt"
        order: req.query.order, // "asc" or "desc"
        select: req.query.select, // comma-separated fields if you want
        // where: JSON.stringify([...]) // if you want to pass Espo "where"
      },
    });

    // Espo usually returns { list: [...], total: n }
    res.json({
      success: true,
      products: data?.list ?? [],
      total: data?.total ?? 0,
    });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Get single product by ID
const getProductById = async (req, res) => {
  try {
    const data = await espoRequest(`/${ENTITY}/${req.params.id}`);
    res.json({ success: true, product: data });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Create new product
const createProduct = async (req, res) => {
  try {
    const data = await espoRequest(`/${ENTITY}`, {
      method: "POST",
      body: req.body,
    });
    res.json({ success: true, product: data });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Update product by ID
const updateProduct = async (req, res) => {
  try {
    const data = await espoRequest(`/${ENTITY}/${req.params.id}`, {
      method: "PUT",
      body: req.body,
    });
    res.json({ success: true, product: data });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Delete product by ID
const deleteProduct = async (req, res) => {
  try {
    await espoRequest(`/${ENTITY}/${req.params.id}`, { method: "DELETE" });
    res.json({ success: true });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Get products by merchTags
const getProductsByMerchTags = async (req, res) => {
  try {
    const { merchTag } = req.params;

    if (!merchTag) {
      return res.status(400).json({
        success: false,
        error: "merchTag parameter is required",
      });
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const offset = (page - 1) * limit;

    // Start with a reasonable batch size that shouldn't cause API issues
    const data = await espoRequest(`/${ENTITY}`, {
      query: {
        maxSize: 100, // Start with smaller batch
        offset: 0,
        orderBy: req.query.orderBy || "createdAt",
        order: req.query.order || "desc",
        select: req.query.select,
      },
    });

    // Filter products that have the exact merchTag in their merchTags array
    const filteredProducts = (data?.list ?? []).filter((product) => {
      // Check if merchTags exists and is an array with the specific tag
      return (
        product.merchTags &&
        Array.isArray(product.merchTags) &&
        product.merchTags.includes(merchTag)
      );
    });

    // Apply pagination to filtered results
    const startIndex = offset;
    const endIndex = startIndex + limit;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    res.json({
      success: true,
      products: paginatedProducts,
      total: filteredProducts.length,
      merchTag: merchTag,
      debug: {
        totalFetched: data?.list?.length || 0,
        filteredCount: filteredProducts.length,
        searchTag: merchTag,
      },
    });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ success: false, error: e.data || e.message });
  }
};

// Generic method to get unique values for any field
const getUniqueFieldValues = async (req, res) => {
  try {
    const { fieldName } = req.params;

    if (!fieldName) {
      return res.status(400).json({
        success: false,
        error: "fieldName parameter is required",
      });
    }

    const data = await espoRequest(`/${ENTITY}`, {
      query: {
        maxSize: 100,
        offset: 0,
      },
    });

    const uniqueValues = new Set();

    (data?.list ?? []).forEach((product) => {
      const fieldValue = product[fieldName];

      if (fieldValue !== null && fieldValue !== undefined) {
        // Handle array fields (like color, content, finish)
        if (Array.isArray(fieldValue)) {
          fieldValue.forEach((item) => {
            if (item && item.toString().trim() !== "") {
              uniqueValues.add(item.toString().trim());
            }
          });
        }
        // Handle string fields (like category, design, structure, motif)
        else if (typeof fieldValue === "string") {
          const trimmedValue = fieldValue.trim();
          if (trimmedValue !== "" && trimmedValue !== "N/A") {
            uniqueValues.add(trimmedValue);
          }
        }
        // Handle numeric fields (like purchaseMOQ, salesMOQ, gsm, ozs, purchasePrice, etc.)
        else if (typeof fieldValue === "number") {
          uniqueValues.add(fieldValue.toString());
        }
        // Handle boolean fields
        else if (typeof fieldValue === "boolean") {
          uniqueValues.add(fieldValue.toString());
        }
      }
    });

    // Sort values - numeric values will be sorted as strings, but that's usually fine for display
    const sortedValues = Array.from(uniqueValues).sort((a, b) => {
      // Try to sort numerically if both values are numbers
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      // Otherwise sort alphabetically
      return a.localeCompare(b);
    });

    res.json({
      success: true,
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

// Generic method to get products by field name and value
const getProductsByFieldValue = async (req, res) => {
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

    // Fetch products from API
    const data = await espoRequest(`/${ENTITY}`, {
      query: {
        maxSize: 100,
        offset: 0,
        orderBy: req.query.orderBy || "createdAt",
        order: req.query.order || "desc",
        select: req.query.select,
      },
    });

    // Filter products that match the field value
    const filteredProducts = (data?.list ?? []).filter((product) => {
      const productFieldValue = product[fieldName];

      if (!productFieldValue) return false;

      // Handle array fields (like color, content, finish, merchTags)
      if (Array.isArray(productFieldValue)) {
        return productFieldValue.some(
          (item) =>
            item &&
            item.toString().trim().toLowerCase() === fieldValue.toLowerCase()
        );
      }
      // Handle string fields (like category, design, structure, motif)
      else if (typeof productFieldValue === "string") {
        return (
          productFieldValue.trim().toLowerCase() === fieldValue.toLowerCase()
        );
      }
      // Handle other types (numbers, etc.)
      else {
        return (
          productFieldValue.toString().toLowerCase() ===
          fieldValue.toLowerCase()
        );
      }
    });

    // Apply pagination to filtered results
    const startIndex = offset;
    const endIndex = startIndex + limit;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    res.json({
      success: true,
      products: paginatedProducts,
      total: filteredProducts.length,
      field: fieldName,
      value: fieldValue,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(filteredProducts.length / limit),
      },
      debug: {
        totalFetched: data?.list?.length || 0,
        filteredCount: filteredProducts.length,
        searchField: fieldName,
        searchValue: fieldValue,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({
      success: false,
      error: e.data || e.message,
    });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByMerchTags,
  getUniqueFieldValues,
  getProductsByFieldValue,
};
