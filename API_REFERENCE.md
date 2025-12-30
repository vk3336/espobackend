# API Reference Guide

## Authentication

All requests to EspoCRM are authenticated using an API key passed in the `X-Api-Key` header. This is handled automatically by the backend.

## Data Models

### Product Model

```typescript
interface Product {
  id: string; // Unique product identifier
  name: string; // Product name
  price?: number; // Product price
  description?: string; // Product description
  merchTags?: string[]; // Array of merchandise tags
  createdAt?: string; // ISO 8601 timestamp
  updatedAt?: string; // ISO 8601 timestamp
  // Additional EspoCRM fields...
}
```

### API Response Model

```typescript
interface ApiResponse<T> {
  success: boolean; // Operation success status
  data?: T; // Response data (varies by endpoint)
  error?: string; // Error message (if success is false)
  total?: number; // Total count (for paginated responses)
}
```

## Detailed Endpoint Documentation

### GET /product

Retrieve a paginated list of all products.

**Parameters:**

- `page` (optional): Page number, starting from 1
- `limit` (optional): Number of items per page (max 100)
- `orderBy` (optional): Field to sort by
- `order` (optional): Sort direction ('asc' or 'desc')
- `select` (optional): Comma-separated list of fields to return

**Example Request:**

```http
GET /api/product?page=2&limit=25&orderBy=name&order=asc&select=id,name,price
```

**Response Schema:**

```json
{
  "success": true,
  "products": [Product],
  "total": number
}
```

### GET /product/:id

Retrieve a single product by its ID.

**Path Parameters:**

- `id` (required): Product ID

**Example Request:**

```http
GET /api/product/507f1f77bcf86cd799439011
```

**Response Schema:**

```json
{
  "success": true,
  "product": Product
}
```

### POST /product

Create a new product.

**Request Body:**

```json
{
  "name": "string (required)",
  "price": "number (optional)",
  "description": "string (optional)",
  "merchTags": ["string"] // optional array
}
```

**Example Request:**

```http
POST /api/product
Content-Type: application/json

{
  "name": "Wireless Headphones",
  "price": 199.99,
  "description": "High-quality wireless headphones with noise cancellation",
  "merchTags": ["electronics", "audio", "wireless"]
}
```

**Response Schema:**

```json
{
  "success": true,
  "product": Product
}
```

### PUT /product/:id

Update an existing product.

**Path Parameters:**

- `id` (required): Product ID

**Request Body:**
Any valid product fields to update (partial update supported).

**Example Request:**

```http
PUT /api/product/507f1f77bcf86cd799439011
Content-Type: application/json

{
  "price": 179.99,
  "description": "Updated description with new features"
}
```

**Response Schema:**

```json
{
  "success": true,
  "product": Product
}
```

### DELETE /product/:id

Delete a product by its ID.

**Path Parameters:**

- `id` (required): Product ID

**Example Request:**

```http
DELETE /api/product/507f1f77bcf86cd799439011
```

**Response Schema:**

```json
{
  "success": true
}
```

### GET /product/producttag/:merchTag

Retrieve products filtered by a specific merchandise tag.

**Path Parameters:**

- `merchTag` (required): The merchandise tag to filter by

**Query Parameters:**

- `page` (optional): Page number, starting from 1
- `limit` (optional): Number of items per page
- `orderBy` (optional): Field to sort by (default: 'createdAt')
- `order` (optional): Sort direction (default: 'desc')
- `select` (optional): Comma-separated list of fields to return

**Example Request:**

```http
GET /api/product/producttag/electronics?page=1&limit=10
```

**Response Schema:**

```json
{
  "success": true,
  "products": [Product],
  "total": number,
  "merchTag": "string",
  "debug": {
    "totalFetched": number,
    "filteredCount": number,
    "searchTag": "string"
  }
}
```

## Error Codes and Messages

### HTTP Status Codes

| Code | Meaning               | Description                |
| ---- | --------------------- | -------------------------- |
| 200  | OK                    | Request successful         |
| 400  | Bad Request           | Invalid request parameters |
| 404  | Not Found             | Resource not found         |
| 500  | Internal Server Error | Server or EspoCRM error    |

### Common Error Messages

| Error Message                    | Cause                      | Solution                               |
| -------------------------------- | -------------------------- | -------------------------------------- |
| "EspoCRM request failed"         | EspoCRM API error          | Check EspoCRM connectivity and API key |
| "Product not found"              | Invalid product ID         | Verify the product ID exists           |
| "merchTag parameter is required" | Missing required parameter | Provide the merchTag parameter         |
| "Route not found"                | Invalid endpoint           | Check the API endpoint URL             |

## Rate Limiting

Currently, there are no rate limits implemented on the backend. However, EspoCRM may have its own rate limiting policies. Consider implementing rate limiting for production use.

## Pagination

All list endpoints support pagination:

- **Default page size**: 20 items
- **Maximum page size**: 100 items (configurable)
- **Page numbering**: Starts from 1

**Pagination Response Format:**

```json
{
  "success": true,
  "products": [...],
  "total": 150,  // Total number of items across all pages
}
```

## Field Selection

Use the `select` parameter to limit returned fields and improve performance:

```http
GET /api/product?select=id,name,price
```

This returns only the specified fields in the response.

## Sorting

Control result ordering with `orderBy` and `order` parameters:

```http
GET /api/product?orderBy=createdAt&order=desc
```

**Available sort orders:**

- `asc`: Ascending order
- `desc`: Descending order

## Best Practices

### Request Headers

Always include appropriate headers:

```http
Content-Type: application/json
Accept: application/json
```

### Error Handling

Always check the `success` field in responses:

```javascript
if (response.success) {
  // Handle successful response
  console.log(response.products);
} else {
  // Handle error
  console.error(response.error);
}
```

### Pagination

For large datasets, use pagination to avoid timeouts:

```javascript
let page = 1;
const limit = 50;
let allProducts = [];

do {
  const response = await fetch(`/api/product?page=${page}&limit=${limit}`);
  const data = await response.json();

  if (data.success) {
    allProducts.push(...data.products);
    page++;
  }
} while (data.products.length === limit);
```

### Filtering by Tags

When filtering by merchandise tags, the API performs exact matches:

```http
GET /api/product/producttag/electronics  // Matches products with "electronics" tag
```

## SDK Examples

### JavaScript/Node.js

```javascript
class EspoProductAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async getAllProducts(options = {}) {
    const params = new URLSearchParams(options);
    const response = await fetch(`${this.baseUrl}/api/product?${params}`);
    return response.json();
  }

  async getProduct(id) {
    const response = await fetch(`${this.baseUrl}/api/product/${id}`);
    return response.json();
  }

  async createProduct(productData) {
    const response = await fetch(`${this.baseUrl}/api/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
    });
    return response.json();
  }

  async updateProduct(id, updates) {
    const response = await fetch(`${this.baseUrl}/api/product/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return response.json();
  }

  async deleteProduct(id) {
    const response = await fetch(`${this.baseUrl}/api/product/${id}`, {
      method: "DELETE",
    });
    return response.json();
  }

  async getProductsByTag(tag, options = {}) {
    const params = new URLSearchParams(options);
    const response = await fetch(
      `${this.baseUrl}/api/product/producttag/${tag}?${params}`
    );
    return response.json();
  }
}

// Usage
const api = new EspoProductAPI("http://localhost:3000");
const products = await api.getAllProducts({ page: 1, limit: 10 });
```

### Python

```python
import requests
import json

class EspoProductAPI:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})

    def get_all_products(self, **params):
        response = self.session.get(f"{self.base_url}/api/product", params=params)
        return response.json()

    def get_product(self, product_id):
        response = self.session.get(f"{self.base_url}/api/product/{product_id}")
        return response.json()

    def create_product(self, product_data):
        response = self.session.post(
            f"{self.base_url}/api/product",
            data=json.dumps(product_data)
        )
        return response.json()

    def update_product(self, product_id, updates):
        response = self.session.put(
            f"{self.base_url}/api/product/{product_id}",
            data=json.dumps(updates)
        )
        return response.json()

    def delete_product(self, product_id):
        response = self.session.delete(f"{self.base_url}/api/product/{product_id}")
        return response.json()

    def get_products_by_tag(self, tag, **params):
        response = self.session.get(
            f"{self.base_url}/api/product/producttag/{tag}",
            params=params
        )
        return response.json()

# Usage
api = EspoProductAPI('http://localhost:3000')
products = api.get_all_products(page=1, limit=10)
```
