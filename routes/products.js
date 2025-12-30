const express = require("express");
const {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByMerchTags,
} = require("../controller/productController");

const router = express.Router();

// GET /api/products - Get all products
router.get("/", getAllProducts);

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
