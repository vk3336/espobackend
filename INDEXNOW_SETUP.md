# IndexNow Implementation Guide

## Overview

IndexNow is implemented in your Node.js backend to automatically notify search engines when your content changes. This helps with faster indexing of your product pages and other content.

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Enable/disable IndexNow submissions
INDEXNOW_ENABLED=true

# IndexNow endpoint
INDEXNOW_ENDPOINT=https://api.indexnow.org/indexnow

# Your ownership key (8-128 chars: a-z A-Z 0-9 and -)
INDEXNOW_KEY=vk3336

# Your frontend domain (NO protocol)
INDEXNOW_HOST=www.amrita-fashions.com

# Optional: Custom key file location
# INDEXNOW_KEY_LOCATION=https://www.amrita-fashions.com/path/to/keyfile.txt

# Optional: Multiple hosts as JSON array
# INDEXNOW_HOSTS_JSON=["www.amrita-fashions.com","shop.amrita-fashions.com"]

# Optional: Auth token for protected endpoints
# INDEXNOW_AUTH_TOKEN=your-secret-token
```

### Key File Setup (CRITICAL)

1. Create a file named `vk3336.txt` in your frontend's public directory
2. The file content should be exactly: `vk3336`
3. The file must be accessible at: `https://www.amrita-fashions.com/vk3336.txt`

**This is required for IndexNow to verify domain ownership!**

## API Endpoints

### Health Check

```
GET /api/indexnow/health
```

Check IndexNow configuration status.

### Manual URL Submission

```
POST /api/indexnow/submit
Content-Type: application/json

{
  "urls": [
    "https://www.amrita-fashions.com/products/product-1",
    "https://www.amrita-fashions.com/products/product-2"
  ]
}
```

### Product URL Submission

```
POST /api/indexnow/products
Content-Type: application/json

{
  "slugs": ["product-1", "product-2"],
  "action": "updated"
}
```

### Multi-Host Submission

```
POST /api/indexnow/multi-host
Content-Type: application/json

{
  "urls": ["https://www.amrita-fashions.com/page1"]
}
```

### Get Key Information

```
GET /api/indexnow/key
```

Returns key file information for setup.

## Automatic Integration

### Using Middleware (Recommended)

Add to your product routes for automatic notifications:

```javascript
const { createIndexNowMiddleware } = require("../utils/indexnowHelper");

// Add to your product routes
router.use(createIndexNowMiddleware());

// Your existing routes will now automatically notify IndexNow
router.post("/products", (req, res) => {
  // Your product creation logic
  res.json({ success: true, id: "product-123" });
  // IndexNow notification happens automatically
});
```

### Manual Notifications

```javascript
const { notifyProductChange } = require("../utils/indexnowHelper");

// After product operations
await notifyProductChange(["product-1", "product-2"], "updated");
```

### Batch Notifications

```javascript
const { notifyBatchChanges } = require("../utils/indexnowHelper");

const changes = [
  { id: "product-1", action: "created" },
  { id: "product-2", action: "updated" },
  { id: "product-3", action: "deleted" },
];

await notifyBatchChanges(changes);
```

## Testing

1. **Check Configuration:**

   ```bash
   curl https://your-backend.com/api/indexnow/health
   ```

2. **Test Key File:**

   ```bash
   curl https://www.amrita-fashions.com/vk3336.txt
   ```

   Should return: `vk3336`

3. **Test Submission:**
   ```bash
   curl -X POST https://your-backend.com/api/indexnow/submit \
     -H "Content-Type: application/json" \
     -d '{"urls":["https://www.amrita-fashions.com/test-page"]}'
   ```

## Best Practices

1. **Don't Over-Submit:** Only submit URLs when content actually changes
2. **Batch Operations:** Use batch endpoints for multiple URL changes
3. **Error Handling:** IndexNow failures shouldn't break your main application flow
4. **Rate Limiting:** The implementation handles 429 responses automatically
5. **Monitoring:** Check logs for submission success/failure

## Troubleshooting

### Common Issues

1. **Key File Not Found (403/404 errors):**
   - Ensure `vk3336.txt` exists in your frontend's public directory
   - Verify the file is accessible via browser

2. **Invalid Host Error:**
   - Check `INDEXNOW_HOST` doesn't include protocol (no https://)
   - Ensure host matches where key file is hosted

3. **Rate Limited (429 errors):**
   - The system automatically waits 30 seconds and retries
   - Consider reducing submission frequency

4. **URLs Not Being Indexed:**
   - IndexNow only notifies search engines, it doesn't guarantee indexing
   - Ensure URLs are publicly accessible and contain quality content

## Integration with Your Current Routes

Since you have dynamic API routes (`/api/` and `/vivek/`), IndexNow endpoints are available at:

- `/api/indexnow/*`
- `/vivek/indexnow/*`

You can integrate automatic notifications into your existing product management workflows by adding the middleware or manual calls where products are created, updated, or deleted.
