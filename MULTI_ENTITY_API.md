# Multi-Entity API Documentation

## Overview

This API now supports multiple EspoCRM entities through a single, unified interface. You can work with any entity defined in your `.env` file using the same API structure.

## Configuration

### Environment Variables

```env
# Multiple entities (comma-separated)
ESPO_ENTITIES=CProduct,COrder,CCustomer,CInvoice

# Dynamic API base names (comma-separated)
API_BASE_NAMES=api,vivek
```

## Available Endpoints

For each entity defined in `ESPO_ENTITIES`, the following routes are automatically created:

### Entity Routes Pattern

- **Base URL**: `/{apiBase}/{entityName}`
- **Entity Name**: Lowercase entity name with 'C' prefix removed
  - `CProduct` → `product`
  - `COrder` → `order`
  - `CCustomer` → `customer`
  - `CInvoice` → `invoice`

### CRUD Operations

#### Get All Records

```
GET /{apiBase}/{entity}
Query Parameters:
- page: Page number (default: 1)
- limit: Records per page (default: 20)
- orderBy: Field to order by
- order: 'asc' or 'desc'
- select: Comma-separated fields to select
```

#### Get Record by ID

```
GET /{apiBase}/{entity}/{id}
```

#### Create New Record

```
POST /{apiBase}/{entity}
Body: JSON object with record data
```

#### Update Record

```
PUT /{apiBase}/{entity}/{id}
Body: JSON object with updated data
```

#### Delete Record

```
DELETE /{apiBase}/{entity}/{id}
```

### Advanced Queries

#### Get Unique Field Values

```
GET /{apiBase}/{entity}/fieldname/{fieldName}
```

#### Get Records by Field Value

```
GET /{apiBase}/{entity}/fieldname/{fieldName}/{fieldValue}
Query Parameters:
- page, limit, orderBy, order, select (same as above)
```

## Examples

### Working with Products

```bash
# Get all products
GET /api/product

# Get product by ID
GET /api/product/123

# Create new product
POST /api/product
```

### Working with Orders

```bash
# Get all orders
GET /api/order

# Get order by ID
GET /api/order/456

# Get orders by status
GET /api/order/fieldname/status/completed
```

### Working with Customers

```bash
# Get all customers
GET /api/customer

# Get unique customer types
GET /api/customer/fieldname/customerType

# Get customers by type
GET /api/customer/fieldname/customerType/premium
```

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": [...], // or single object for individual records
  "total": 100,  // for list endpoints
  "entity": "CProduct", // original entity name
  "pagination": { // for paginated results
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

## Backward Compatibility

~~The original `/api/product` and `/vivek/product` routes are still available and work exactly as before, ensuring no breaking changes to existing implementations.~~

**Update**: The old product-specific routes have been removed. Now all entities (including products) use the same unified API structure. If you have `CProduct` in your `ESPO_ENTITIES`, you'll get `/api/product` and `/vivek/product` routes automatically through the generic system.

## Adding New Entities

To add support for a new entity:

1. Add the entity name to `ESPO_ENTITIES` in your `.env` file
2. Restart the server
3. The new entity routes will be automatically available

Example:

```env
ESPO_ENTITIES=CProduct,COrder,CCustomer,CInvoice,CSupplier,CWarehouse
```

This will create routes for: `product`, `order`, `customer`, `invoice`, `supplier`, `warehouse`
