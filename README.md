# EspoCRM Backend API

A Node.js Express backend that provides RESTful API endpoints for managing products through EspoCRM integration.

## 🚀 Features

- **EspoCRM Integration**: Direct API communication with EspoCRM
- **Product Management**: Full CRUD operations for products
- **Flexible Routing**: Support for multiple API base names
- **Tag-based Filtering**: Filter products by merchandise tags
- **Pagination Support**: Built-in pagination for large datasets
- **Error Handling**: Comprehensive error handling and logging

## 📋 Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Request/Response Examples](#requestresponse-examples)
- [Error Handling](#error-handling)
- [Environment Variables](#environment-variables)
- [Development](#development)

## 🛠 Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd nodebackend
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables (see [Configuration](#configuration))

4. Start the server:

```bash
npm start
```

## ⚙️ Configuration

Create a `.env` file in the root directory with the following variables:

```env
# EspoCRM Configuration
ESPO_BASE_URL=https://your-espo-instance.com
ESPO_API_KEY=your-api-key-here
ESPO_API_PREFIX=/api/v1
ESPO_PRODUCT_ENTITY=CProduct

# Server Configuration
PORT=3000

# Dynamic API base names (comma-separated)
API_BASE_NAMES=api,vivek
```

### Environment Variables Explained

| Variable              | Description                        | Default    | Required |
| --------------------- | ---------------------------------- | ---------- | -------- |
| `ESPO_BASE_URL`       | Your EspoCRM instance URL          | -          | ✅       |
| `ESPO_API_KEY`        | EspoCRM API key for authentication | -          | ✅       |
| `ESPO_API_PREFIX`     | API prefix path                    | `/api/v1`  | ❌       |
| `ESPO_PRODUCT_ENTITY` | EspoCRM entity name for products   | `CProduct` | ❌       |
| `PORT`                | Server port                        | `3000`     | ❌       |
| `API_BASE_NAMES`      | Comma-separated API base names     | `api`      | ❌       |

## 🔗 API Endpoints

The API supports multiple base names. If `API_BASE_NAMES=api,vivek`, all endpoints are available under both `/api` and `/vivek` prefixes.

### Base URL Structure

```
http://localhost:3000/{baseName}/product
```

### Available Endpoints

| Method   | Endpoint                                   | Description                      |
| -------- | ------------------------------------------ | -------------------------------- |
| `GET`    | `/{baseName}/product`                      | Get all products with pagination |
| `GET`    | `/{baseName}/product/:id`                  | Get single product by ID         |
| `GET`    | `/{baseName}/product/producttag/:merchTag` | Get products by merchandise tag  |
| `POST`   | `/{baseName}/product`                      | Create new product               |
| `PUT`    | `/{baseName}/product/:id`                  | Update product by ID             |
| `DELETE` | `/{baseName}/product/:id`                  | Delete product by ID             |

### Query Parameters

#### For GET `/product` (Get All Products)

| Parameter | Type   | Description                       | Default |
| --------- | ------ | --------------------------------- | ------- |
| `page`    | number | Page number for pagination        | `1`     |
| `limit`   | number | Number of items per page          | `20`    |
| `orderBy` | string | Field to order by                 | -       |
| `order`   | string | Order direction (`asc` or `desc`) | -       |
| `select`  | string | Comma-separated fields to select  | -       |

#### For GET `/product/producttag/:merchTag` (Get by Tag)

| Parameter | Type   | Description                      | Default     |
| --------- | ------ | -------------------------------- | ----------- |
| `page`    | number | Page number for pagination       | `1`         |
| `limit`   | number | Number of items per page         | `20`        |
| `orderBy` | string | Field to order by                | `createdAt` |
| `order`   | string | Order direction                  | `desc`      |
| `select`  | string | Comma-separated fields to select | -           |

## 📝 Request/Response Examples

### 1. Get All Products

**Request:**

```http
GET /api/product?page=1&limit=10&orderBy=createdAt&order=desc
```

**Response:**

```json
{
  "success": true,
  "products": [
    {
      "id": "product123",
      "name": "Sample Product",
      "price": 99.99,
      "merchTags": ["electronics", "gadgets"],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 150
}
```

### 2. Get Single Product

**Request:**

```http
GET /api/product/product123
```

**Response:**

```json
{
  "success": true,
  "product": {
    "id": "product123",
    "name": "Sample Product",
    "price": 99.99,
    "description": "A great product",
    "merchTags": ["electronics", "gadgets"],
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### 3. Create New Product

**Request:**

```http
POST /api/product
Content-Type: application/json

{
  "name": "New Product",
  "price": 149.99,
  "description": "An amazing new product",
  "merchTags": ["new", "featured"]
}
```

**Response:**

```json
{
  "success": true,
  "product": {
    "id": "newproduct456",
    "name": "New Product",
    "price": 149.99,
    "description": "An amazing new product",
    "merchTags": ["new", "featured"],
    "createdAt": "2024-01-15T11:00:00Z"
  }
}
```

### 4. Update Product

**Request:**

```http
PUT /api/product/product123
Content-Type: application/json

{
  "name": "Updated Product Name",
  "price": 199.99
}
```

**Response:**

```json
{
  "success": true,
  "product": {
    "id": "product123",
    "name": "Updated Product Name",
    "price": 199.99,
    "description": "A great product",
    "merchTags": ["electronics", "gadgets"],
    "updatedAt": "2024-01-15T12:00:00Z"
  }
}
```

### 5. Get Products by Merchandise Tag

**Request:**

```http
GET /api/product/producttag/electronics?page=1&limit=5
```

**Response:**

```json
{
  "success": true,
  "products": [
    {
      "id": "product123",
      "name": "Sample Product",
      "price": 99.99,
      "merchTags": ["electronics", "gadgets"]
    }
  ],
  "total": 25,
  "merchTag": "electronics",
  "debug": {
    "totalFetched": 100,
    "filteredCount": 25,
    "searchTag": "electronics"
  }
}
```

### 6. Delete Product

**Request:**

```http
DELETE /api/product/product123
```

**Response:**

```json
{
  "success": true
}
```

## ❌ Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### Common HTTP Status Codes

| Status Code | Description                                               |
| ----------- | --------------------------------------------------------- |
| `200`       | Success                                                   |
| `400`       | Bad Request (missing required parameters)                 |
| `404`       | Not Found (product or route not found)                    |
| `500`       | Internal Server Error (EspoCRM API error or server error) |

### Error Response Examples

**404 - Product Not Found:**

```json
{
  "success": false,
  "error": "Product not found"
}
```

**400 - Missing Parameter:**

```json
{
  "success": false,
  "error": "merchTag parameter is required"
}
```

**500 - EspoCRM API Error:**

```json
{
  "success": false,
  "error": "EspoCRM request failed"
}
```

## 🏗 Architecture

### Project Structure

```
├── controller/
│   ├── espoClient.js      # EspoCRM API client
│   └── productController.js # Product business logic
├── routes/
│   └── products.js        # Product route definitions
├── index.js              # Main server file
├── package.json          # Dependencies and scripts
└── .env                  # Environment configuration
```

### Key Components

1. **espoClient.js**: Handles all communication with EspoCRM API
2. **productController.js**: Contains business logic for product operations
3. **products.js**: Defines route handlers and middleware
4. **index.js**: Main server setup with dynamic routing

## 🔧 Development

### Adding New Endpoints

1. Add controller function in `controller/productController.js`
2. Add route in `routes/products.js`
3. Test the endpoint

### Adding New Entities

1. Create new controller file (e.g., `controller/customerController.js`)
2. Create new route file (e.g., `routes/customers.js`)
3. Add entity configuration to `.env`
4. Register routes in `index.js`

### Testing

Use tools like Postman, curl, or any HTTP client to test the endpoints:

```bash
# Test health check
curl http://localhost:3000/

# Test get all products
curl http://localhost:3000/api/product

# Test create product
curl -X POST http://localhost:3000/api/product \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Product","price":99.99}'
```

## 🚀 Deployment

### Environment Setup

1. Set production environment variables
2. Ensure EspoCRM instance is accessible
3. Configure proper API keys and permissions

### Production Considerations

- Use process managers like PM2
- Set up proper logging
- Configure CORS if needed
- Add rate limiting
- Set up monitoring and health checks

## 📞 Support

For issues and questions:

1. Check the error logs
2. Verify EspoCRM connectivity
3. Ensure API key has proper permissions
4. Review environment configuration

---

**Note**: This API serves as a bridge between your frontend applications and EspoCRM, providing a clean RESTful interface for product management operations.
#   e s p o b a c k e n d 
 
 