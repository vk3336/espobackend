# IndexNow Sitemap Scheduler Implementation Guide

## Overview

IndexNow scheduler automatically fetches URLs from your sitemap.xml and submits them to search engines on a scheduled basis. This is the most efficient approach as it uses your existing sitemap that contains all your website URLs.

## How It Works

1. **Scheduled Execution**: Runs automatically based on cron schedule (default: daily at 2 AM UTC)
2. **Sitemap Fetching**: Downloads your sitemap.xml file
3. **URL Extraction**: Parses XML and extracts all `<loc>` URLs
4. **Batch Submission**: Submits all URLs to IndexNow in optimized batches
5. **Search Engine Notification**: IndexNow notifies all major search engines

## Configuration

### Environment Variables

```env
# Enable/disable IndexNow scheduler
INDEXNOW_SCHEDULER_ENABLED=true

# IndexNow endpoint
INDEXNOW_ENDPOINT=https://api.indexnow.org/indexnow

# Your ownership key (8-128 chars: a-z A-Z 0-9 and -)
INDEXNOW_KEY=vk3336abc123

# Your frontend domain (NO protocol)
INDEXNOW_HOST=www.amrita-fashions.com

# Sitemap URL to fetch all URLs from
INDEXNOW_SITEMAP_URL=https://www.amrita-fashions.com/sitemap.xml

# Schedule (cron format) - Default: daily at 2 AM UTC
INDEXNOW_SCHEDULE=0 2 * * *

# Timezone for scheduler (optional)
INDEXNOW_TIMEZONE=UTC

# Run once on startup for testing (optional)
# INDEXNOW_RUN_ON_STARTUP=true
```

### Key File Setup (CRITICAL)

1. Create a file named `vk3336abc123.txt` in your frontend's public directory
2. The file content should be exactly: `vk3336abc123`
3. The file must be accessible at: `https://www.amrita-fashions.com/vk3336abc123.txt`

## Schedule Examples

```env
# Daily at 2 AM UTC
INDEXNOW_SCHEDULE=0 2 * * *

# Every 6 hours
INDEXNOW_SCHEDULE=0 */6 * * *

# Weekly on Sunday at 3 AM
INDEXNOW_SCHEDULE=0 3 * * 0

# Every 2 hours during business hours (9 AM - 5 PM)
INDEXNOW_SCHEDULE=0 9-17/2 * * *

# Twice daily (6 AM and 6 PM)
INDEXNOW_SCHEDULE=0 6,18 * * *
```

## API Endpoints

### Health Check

```
GET /api/indexnow/health
```

Check IndexNow scheduler configuration and status.

### Manual Trigger

```
POST /api/indexnow/trigger
```

Manually trigger the scheduler for testing (runs in background).

### Test Sitemap Parsing

```
GET /api/indexnow/test-sitemap
```

Test sitemap fetching and parsing without submitting to IndexNow.

### Get Key Information

```
GET /api/indexnow/key
```

Returns key file information for setup verification.

## Sitemap Requirements

Your sitemap.xml should be accessible and contain URLs in standard format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.amrita-fashions.com/</loc>
    <lastmod>2024-02-03</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.amrita-fashions.com/fabric/silk-saree-red</loc>
    <lastmod>2024-02-03</lastmod>
    <priority>0.8</priority>
  </url>
  <!-- More URLs... -->
</urlset>
```

## Testing

### 1. Check Configuration

```bash
curl https://your-backend.com/api/indexnow/health
```

### 2. Verify Key File

```bash
curl https://www.amrita-fashions.com/vk3336abc123.txt
```

Should return: `vk3336abc123`

### 3. Test Sitemap Parsing

```bash
curl https://your-backend.com/api/indexnow/test-sitemap
```

### 4. Manual Trigger

```bash
curl -X POST https://your-backend.com/api/indexnow/trigger
```

### 5. Check Logs

Monitor your server logs for scheduler activity:

```
[IndexNow Scheduler] Starting at 2024-02-03T02:00:00.000Z
[IndexNow Scheduler] Fetching sitemap from: https://www.amrita-fashions.com/sitemap.xml
[IndexNow Scheduler] Parsed 150 URLs from sitemap
[IndexNow Scheduler] Successfully fetched 150 URLs from sitemap
[IndexNow Scheduler] Submitting 150 URLs to IndexNow...
[IndexNow Scheduler] ✅ Success! Submitted 150 URLs in 3s
[IndexNow Scheduler] Sample URLs submitted:
  - https://www.amrita-fashions.com/
  - https://www.amrita-fashions.com/fabric/silk-saree-red
  - https://www.amrita-fashions.com/fabric/cotton-kurta-blue
  ... and 147 more URLs
```

## What Gets Submitted

All URLs from your sitemap.xml, for example:

```
https://www.amrita-fashions.com/
https://www.amrita-fashions.com/fabric/silk-saree-red
https://www.amrita-fashions.com/fabric/cotton-kurta-blue
https://www.amrita-fashions.com/fabric/nokia-602-plain-100cotton-125gsm-mercerized-butter-yellow
https://www.amrita-fashions.com/fabric/nokia601-plain-poplin-100cotton-125gsm-mercerized-red
... (all URLs from your sitemap)
```

## Benefits

✅ **Fully Automated** - No manual intervention required  
✅ **Comprehensive Coverage** - All URLs from sitemap included automatically  
✅ **SEO Optimized** - Regular search engine notifications  
✅ **Efficient** - Uses existing sitemap, no database queries needed  
✅ **Production Ready** - Handles rate limiting and batch processing  
✅ **Simple Configuration** - Just one sitemap URL needed

## Troubleshooting

### Common Issues

1. **Scheduler Not Running**
   - Check `INDEXNOW_SCHEDULER_ENABLED=true`
   - Verify cron schedule format
   - Check server logs for startup messages

2. **No URLs Found in Sitemap**
   - Verify sitemap URL is accessible: `curl https://www.amrita-fashions.com/sitemap.xml`
   - Check sitemap contains `<loc>` tags with valid URLs
   - Ensure sitemap is valid XML format

3. **IndexNow Errors**
   - Verify key file is accessible
   - Check `INDEXNOW_HOST` doesn't include protocol
   - Ensure key is 8-128 characters

4. **Sitemap Fetch Errors**
   - Check sitemap URL is publicly accessible
   - Verify no authentication required for sitemap
   - Ensure sitemap returns valid XML content

## Production Deployment

1. **Deploy Backend** with scheduler enabled
2. **Verify Key File** is accessible on frontend
3. **Test Sitemap** endpoint shows URLs found
4. **Check Health Endpoint** shows valid configuration
5. **Monitor Logs** for first scheduled run
6. **Optional**: Test with manual trigger

The scheduler will automatically start when your application boots and run according to your configured schedule, fetching fresh URLs from your sitemap each time.
