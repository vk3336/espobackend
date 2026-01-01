const express = require("express");
const {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByMerchTags,
  getUniqueFieldValues,
  getProductsByFieldValue,
} = require("../controller/productController");

const router = express.Router();

// GET /api/products - Get all products
router.get("/", getAllProducts);

// Generic route to get unique values for any field
// GET /api/products/fieldname/:fieldName - Get unique values for specified field
router.get("/fieldname/:fieldName", getUniqueFieldValues);

// Generic route to get products by field name and value
// GET /api/products/by/:fieldName/:fieldValue - Get products filtered by field and value
router.get("/fieldname/:fieldName/:fieldValue", getProductsByFieldValue);

// GET /api/products/by-merch-tag/:merchTag - Get products by merchTag
router.get("/producttag/:merchTag", getProductsByMerchTags);

// GET /api/products/:id - Get single product by ID
router.get("/:id", getProductById);

// POST /api/products - Create new product
router.post("/", createProduct);

// PUT /api/products/:id - Update product by ID
router.put("/:id", updateProduct);

// DELETE /api/products/:id - Delete product by ID
router.delete("/:id", deleteProduct);

module.exports = router;
