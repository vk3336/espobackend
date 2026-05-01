# EspoCRM Node.js Backend API

A production-ready Node.js/Express backend that acts as a smart middleware layer between [EspoCRM](https://www.espocrm.com/) and your frontend applications. It exposes EspoCRM entities as clean REST API endpoints, adds intelligent in-memory caching with delta refresh, an AI-powered chat assistant, OTP-based authentication, Cloudinary image optimization, IndexNow SEO pinging, and admin audit tools — all deployable to Vercel as a serverless function.

---

## Features

- **Generic REST API** — auto-generates CRUD endpoints for any EspoCRM entity defined in `.env`
- **Smart Caching** — in-memory cache with delta refresh (only fetches changed records), full refresh, and per-entity TTL control
- **AI Chat Assistant** — OpenAI-powered public chat that searches your catalogue and captures leads into EspoCRM
- **Admin Audit Chat** — internal chat tool for querying and exporting any entity to Excel
- **OTP Authentication** — email-based one-time password login and registration via Gmail
- **Cloudinary Integration** — server-side URL transformation for multiple image variants (web, card, hero, PDF, email)
- **IndexNow Scheduler** — automatically pings search engines with your sitemap URLs on a cron schedule
- **Dynamic Sections** — cross-entity endpoint that matches `TopicPage.slug` with `Product.merchTags`
- **Cache Management API** — endpoints to inspect, clear, and manage cache at runtime
- **Frontend Revalidation** — notifies Next.js ISR frontends to revalidate after data changes
- **Security** — Helmet headers, CORS with multi-origin support, rate limiting, request timeout, exponential backoff retry

---

## Tech Stack

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `helmet` | Security headers |
| `cors` | Cross-origin request control |
| `dotenv` + `dotenv-expand` | Environment variable loading with variable expansion |
| `node-cache` | In-memory caching |
| `node-cron` | Cron job scheduling (IndexNow) |
| `exceljs` | Excel file generation for admin chat exports |
| `nodemailer` | OTP email delivery via Gmail |
| `axios` | HTTP client (used for company info fetch in mailer) |

---

## Project Structure

```
espobackend/
├── index.js                        # App entry point
├── build.js                        # Pre-deployment validation script
├── vercel.json                     # Vercel deployment config
├── package.json
├── .env                            # Local environment variables (not committed)
├── .env.example                    # Environment variable reference template
├── .gitignore
│
├── controller/
│   ├── espoClient.js               # EspoCRM HTTP client (rate limit, retry, dedup)
│   ├── genericController.js        # CRUD + search + dynamic section logic
│   ├── chatController.js           # Public AI chat assistant handler
│   ├── adminChatController.js      # Admin audit chat + Excel export handler
│   └── authController.js          # OTP register / login / verify logic
│
├── routes/
│   ├── generic.js                  # Auto-generated entity routes
│   ├── chat.js                     # Public chat routes
│   ├── adminChat.js                # Admin chat routes
│   ├── auth.js                     # Auth routes (register, login, verify-otp)
│   ├── dynamicSection.js           # Dynamic section routes
│   ├── indexnow.js                 # IndexNow management routes
│   └── cache.js                    # Cache management routes
│
└── utils/
    ├── cache.js                    # Cache read/write/delete/stats helpers
    ├── cacheWarmer.js              # Startup cache warm-up and scheduled refresh
    ├── cloudinary.js               # Cloudinary URL variant builder
    ├── espo.js                     # Bulk relation fetching helpers
    ├── indexnow.js                 # IndexNow HTTP submission utility
    ├── indexnowScheduler.js        # Cron scheduler + sitemap parser for IndexNow
    ├── mailer.js                   # OTP email template + Gmail transporter
    ├── otp.js                      # OTP generation, hashing, verification
    └── revalidateFrontends.js      # Next.js ISR revalidation trigger
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd espobackend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Run locally

```bash
npm start
```

Server starts at `http://localhost:3000`

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. All variables are documented inside `.env.example`.

| Variable | Required | Description |
|---|---|---|
| `ESPO_BASE_URL` | ✅ | Your EspoCRM instance URL |
| `ESPO_API_KEY` | ✅ | EspoCRM API key (Admin → API Keys) |
| `ESPO_ENTITIES` | ✅ | Comma-separated entity names to expose |
| `FRONTEND_URL` | ✅ | Primary frontend URL (CORS + revalidation) |
| `OPENAI_API_KEY` | ⚠️ Optional | Enables AI chat; falls back to heuristic if missing |
| `GMAIL_USER` | ⚠️ Optional | Gmail address for OTP emails |
| `GMAIL_APP_PASSWORD` | ⚠️ Optional | Gmail App Password for OTP emails |
| `OTP_SECRET` | ⚠️ Optional | HMAC secret for OTP hashing |
| `INDEXNOW_KEY` | ⚠️ Optional | IndexNow ownership key |
| `REVALIDATE_SECRET` | ⚠️ Optional | Shared secret for Next.js ISR revalidation |
| `NO_CACHE_ENTITIES` | ⚠️ Optional | Entities to skip long-term caching |
| `CORS_ORIGIN` | ⚠️ Optional | Comma-separated allowed origins |

---

## API Reference

All routes are mounted under `/api`. Entity names from `ESPO_ENTITIES` are lowercased and the leading `C` prefix is stripped (e.g. `CProduct` → `/api/product`).

### Generic Entity Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/:entity` | Get all records (paginated) |
| `GET` | `/api/:entity/:id` | Get single record by ID |
| `POST` | `/api/:entity` | Create new record |
| `PUT` | `/api/:entity/:id` | Update record |
| `DELETE` | `/api/:entity/:id` | Delete record |
| `GET` | `/api/:entity/fieldname/:fieldName` | Get all unique values for a field |
| `GET` | `/api/:entity/fieldname/:fieldName/:fieldValue` | Get records filtered by field value |
| `GET` | `/api/:entity/search/:searchValue` | Search records by keyword or title |

### Auth Routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new account, sends OTP |
| `POST` | `/api/auth/login` | Login with email, sends OTP |
| `POST` | `/api/auth/verify-otp` | Verify OTP code |
| `GET` | `/api/auth/health` | Auth service health check |

### Chat Routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/message` | Send message to public AI chat assistant |
| `GET` | `/api/chat/health` | Chat service health check |

### Admin Chat Routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin-chat/message` | Send audit query, returns markdown + Excel |
| `GET` | `/api/admin-chat/health` | Admin chat health check |

### Dynamic Section Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dynamicsection` | Get all section names where TopicPage slug matches Product merchTags |
| `GET` | `/api/dynamicsection/:merchtag` | Get TopicPage + Products for a specific merchtag |

### IndexNow Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/indexnow/health` | Check IndexNow configuration |
| `GET` | `/api/indexnow/key` | Get IndexNow key info |
| `POST` | `/api/indexnow/trigger` | Manually trigger IndexNow submission |
| `GET` | `/api/indexnow/test-sitemap` | Test sitemap URL parsing |

### Cache Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cache/stats` | Get cache hit/miss statistics |
| `GET` | `/api/cache/keys` | List all cache keys |
| `DELETE` | `/api/cache/all` | Clear entire cache |
| `DELETE` | `/api/cache/entity/:entityName` | Clear cache for one entity |
| `DELETE` | `/api/cache/key` | Delete a specific cache key |

### Health Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Server info + available routes |
| `GET` | `/health` | Detailed health: memory, cache stats, uptime |

---

## File-by-File Reference

---

### `index.js`

The application entry point. Responsibilities:

- Loads `.env` in non-production environments using `dotenv-expand` (supports variable references like `${FRONTEND_URL}`)
- Configures Express with `helmet`, `cors`, `express.json()`, and request logging middleware
- Reads `ESPO_ENTITIES` from env and dynamically registers all entity routes under `/api`
- Mounts chat, admin-chat, auth, dynamicSection, indexnow, and cache routes
- Exports `app` for Vercel serverless (no `listen` call needed)
- In local dev (`require.main === module`), starts the HTTP server and triggers cache warm-up + IndexNow scheduler
- In production with `RUN_STARTUP_JOBS=true`, also starts background jobs after serverless cold start

---

### `build.js`

A pre-deployment validation script run via `npm run build`. It does not compile anything — it validates the project is ready to deploy:

- Checks all required files exist
- Validates required environment variables are set
- Checks `node_modules` is installed
- Does a basic `require()` syntax check on core files
- Verifies `.gitignore` includes `.env`
- Generates `build-report.json` with a full pass/warn/fail summary
- Exits with code `1` if any required check fails, `0` if all pass

---

### `vercel.json`

Vercel deployment configuration:

- Routes all requests (`/(.*)`) to `index.js` as a single serverless function
- Defines a cron job that pings `/health` every 2 days to keep the function warm and prevent cold starts

---

### `controller/espoClient.js`

The core HTTP client for all EspoCRM API communication. Features:

- **Rate limiter** — sliding window limiter (default 10 req/s, configurable via `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS`)
- **In-flight deduplication** — identical concurrent requests share a single in-flight promise, preventing duplicate EspoCRM hits during traffic bursts
- **Retry with exponential backoff** — retries up to 3 times on network errors or 5xx responses, with doubling delay
- **Request timeout** — uses `AbortController` to cancel requests that exceed `REQUEST_TIMEOUT_MS` (default 30s)
- Builds full EspoCRM API URLs from `ESPO_BASE_URL` + `ESPO_API_PREFIX` + path
- Attaches `X-Api-Key` header on every request

---

### `controller/genericController.js`

The largest controller — handles all entity CRUD, search, filtering, caching, and dynamic sections. Key parts:

- **`fetchAllRecords(entityName)`** — fetches all records with a 3-tier cache strategy:
  - Serves from cache if fresh (within `ESPO_DELTA_REFRESH_SECONDS`)
  - Does a delta refresh (only records changed since last fetch) if cache exists but is stale
  - Does a full refresh if cache is too old (beyond `ESPO_FULL_REFRESH_SECONDS`)
- **`createEntityController(entityName)`** — factory that returns all route handlers for an entity:
  - `getAllRecords` — paginated list; CProduct filters by `merchTags=ecatalogue`; CBlog filters by `status=Approved` and `publishedAt <= now`
  - `getRecordById` — single record with cache
  - `createRecord` / `updateRecord` / `deleteRecord` — write operations that invalidate cache and trigger frontend revalidation
  - `getRecordsByFieldValue` — scans all records with loose Unicode-normalized comparison
  - `getUniqueFieldValues` — returns sorted unique values for any field across all records
  - `getBySearchProduct` — keyword/title search across all records
- **`applyCloudinaryToRecords`** — applies Cloudinary URL variants to image fields per entity config
- **`getDynamicSection`** / **`getAllDynamicSections`** — cross-entity endpoints that match `CTopicPage.slug` with `CProduct.merchTags`

---

### `controller/chatController.js`

Handles the public-facing AI chat assistant. Flow per request:

1. Parses user message with OpenAI (`gpt-4o-mini` by default) to extract intent, search query, and contact info — falls back to a no-op structure if OpenAI is unavailable
2. Merges extracted contact info with session context; enriches with heuristic email/phone/name extraction from message text
3. Upserts a Lead record in EspoCRM with the collected contact info (create on first message, update on subsequent)
4. Fetches candidate records from all `CHAT_ENTITIES` with concurrency limiting
5. Scores and ranks records against the parsed query (keyword, color, weave, GSM, structure matching)
6. Builds a structured reply plan based on intent (`availability`, `recommend`, `details`, `lead`, `smalltalk`)
7. Optionally passes the reply plan through OpenAI for natural language generation
8. Returns reply text, product suggestions, and updated context for the frontend to pass back next turn

Captures browser metadata (IP, user agent, page URL) and stores them on the Lead record.

---

### `controller/adminChatController.js`

Handles the internal admin audit chat. Flow per request:

1. Parses the admin message with OpenAI (or heuristic fallback) to determine intent: `list`, `detail`, `audit_nulls`, or `field_summary`
2. Fetches all records for the target entity (up to `HARD_MAX_ROWS = 10,000`) with auto-pagination
3. Executes the requested operation:
   - **`list`** — returns all records as a markdown table + Excel file
   - **`detail`** — fetches and returns a single record by ID
   - **`field_summary`** — lists all field names found across records
   - **`audit_nulls`** — per-record and per-field null/missing value analysis
4. Always generates an Excel file (via `exceljs`) with full untruncated data as a base64 attachment
5. Returns markdown preview (capped at 35 rows) + full Excel download in a single response

---

### `controller/authController.js`

OTP-based authentication against EspoCRM's `CCustomerAccount` entity. Exports three route handlers:

- **`register`** — creates a new `CCustomerAccount` record in EspoCRM, then immediately sends an OTP email
- **`login`** — finds existing account by email, checks cooldown, generates and emails OTP
- **`verifyOtp`** — validates the submitted OTP against the stored HMAC hash, checks expiry and fail count, clears OTP fields on success

OTP fields stored on the EspoCRM record: `otphash`, `otpexpiresat`, `otplastsentat`, `otpfailcount`. Configurable via `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_FAILS`.

---

### `routes/generic.js`

Route factory for entity endpoints. For each entity:

- Creates an Express router with all 7 CRUD + search routes
- Applies `publicCache` middleware on GET routes — sets `Cache-Control` and `Vercel-CDN-Cache-Control` headers for Vercel edge caching (`s-maxage=300, stale-while-revalidate=86400`)
- Skips CDN caching for entities listed in `NO_CACHE_ENTITIES`
- Exports `createEntityRoutes(entityName)` used by `index.js`

---

### `routes/chat.js`

Mounts the public chat routes on an Express router. Returns a factory function `createChatRoutes()` so a fresh router instance is created per API base name. Routes: `GET /health` and `POST /message`.

---

### `routes/adminChat.js`

Mounts the admin chat routes. Same factory pattern as `routes/chat.js`. Routes: `GET /health` and `POST /message`.

---

### `routes/auth.js`

Mounts OTP auth routes: `POST /register`, `POST /login`, `POST /verify-otp`, `GET /health`.

---

### `routes/dynamicSection.js`

Mounts dynamic section routes with CDN cache headers (`s-maxage=300`). Routes: `GET /` (all sections) and `GET /:merchtag` (specific section). Skips caching for authenticated or cookie-bearing requests.

---

### `routes/indexnow.js`

Mounts IndexNow management routes:

- `GET /health` — validates all required IndexNow config is present
- `GET /key` — returns the key value and instructions for placing the key file on the frontend
- `POST /trigger` — manually triggers a full sitemap fetch + IndexNow submission (protected by optional `INDEXNOW_AUTH_TOKEN`)
- `GET /test-sitemap` — fetches and parses the sitemap, returns found URLs for debugging

---

### `routes/cache.js`

Mounts cache management routes for runtime inspection and control:

- `GET /stats` — returns hit count, miss count, key count, and memory size
- `GET /keys` — lists all active cache keys
- `DELETE /all` — flushes the entire cache
- `DELETE /entity/:entityName` — clears all keys for a specific entity
- `DELETE /key` — deletes a single key by name (passed in request body)

---

### `utils/cache.js`

Wraps `node-cache` with entity-aware logic:

- **`getCacheKey(entityName, params)`** — generates consistent cache keys for list, single, field, unique, search, and all-records query types
- **`shouldUseCache(entityName)`** — returns `'timed'` (24h TTL) for normal entities, `'short'` (configurable, default 5s) for `NO_CACHE_ENTITIES`
- **`getCache`** / **`setCache`** — read/write with automatic TTL selection based on entity type
- **`deleteCacheByEntity`** — deletes all keys matching `espo:{entityName}:*`
- **`clearAllCache`** — flushes everything
- **`getCacheStats`** / **`getCacheKeys`** — exposes `node-cache` stats and key list

---

### `utils/cacheWarmer.js`

Runs on server startup (and on a schedule) to pre-populate the cache:

- **`warmUpCache(entities)`** — iterates each entity, fetches all records with pagination, stores the full list and individual records in cache. Skips `NO_CACHE_ENTITIES`.
- **`scheduleCacheRefresh(entities)`** — sets a `setInterval` to re-run `warmUpCache` every `CACHE_REFRESH_INTERVAL_HOURS` (default 24h)

---

### `utils/cloudinary.js`

Server-side Cloudinary URL transformer — no SDK, no API keys needed:

- **`buildCloudinaryUrl(baseUrl, variant)`** — inserts a transformation string into a Cloudinary URL path after the `upload` segment. Replaces any existing transform.
- **`applyCloudinaryVariants(record, imageFields)`** — for each image field in a record, generates 6 variant URLs: `web`, `email`, `pdf`, `card`, `hero`, `large`. Adds them as new fields (e.g. `image1CloudUrlWeb`, `image1CloudUrlHero`).

Transformation presets:

| Variant | Transform |
|---|---|
| `web` | `f_auto,q_auto,c_limit` |
| `email` | `f_jpg,q_75,w_600,c_limit` |
| `pdf` | `f_jpg,q_80,w_1200,c_limit` |
| `card` | `f_auto,q_auto,w_300,h_300,c_fill,g_auto` |
| `hero` | `f_auto,q_auto,w_1600,dpr_auto,c_limit` |
| `large` | `f_auto,q_auto,w_2000,dpr_auto,c_limit` |

---

### `utils/espo.js`

Bulk relation-fetching helpers to avoid N+1 queries:

- **`attachCollections(records, opts)`** — collects all unique relation IDs from a list of records, fetches them from EspoCRM in chunks of 80 using the `in` filter, then attaches the related object to each record
- **`attachRelatedEntities(records, entityConfigs)`** — same pattern but for multiple entity types in one pass
- **`chunk(arr, size)`** — splits an array into chunks (used to stay within URL length limits)

---

### `utils/indexnow.js`

Low-level IndexNow HTTP submission utility:

- **`submitIndexNow({ endpoint, host, key, urls })`** — deduplicates URLs, splits into batches of 10,000 (IndexNow's max per request), POSTs each batch to the IndexNow API, handles 429 rate limiting with a 30s wait, and returns a result summary

---

### `utils/indexnowScheduler.js`

Cron-based scheduler that automatically submits your sitemap to IndexNow:

- **`startIndexNowScheduler()`** — validates the cron expression, schedules `runScheduledIndexNow` using `node-cron`. Optionally runs once on startup if `INDEXNOW_RUN_ON_STARTUP=true`.
- **`runScheduledIndexNow()`** — fetches `FRONTEND_URL/sitemap.xml`, parses all `<loc>` URLs, submits them via `submitIndexNow`
- **`triggerManualIndexNow()`** — manually invokes `runScheduledIndexNow` (used by the `/trigger` route)
- **`testSitemapParsing()`** — fetches and parses the sitemap, logs and returns found URLs (used by the `/test-sitemap` route)

Default schedule: `0 2 * * *` (2 AM daily). Configurable via `INDEXNOW_SCHEDULE` and `INDEXNOW_TIMEZONE`.

---

### `utils/mailer.js`

Gmail-based OTP email sender:

- **`sendOtpEmail(to, firstName, otp, ttlMinutes)`** — sends a branded HTML email with the OTP code
- Fetches live company information (name, address, phone, social links) from `BACKEND_COMPANY_INFORMATION` API and caches it for 24 hours
- Falls back to hardcoded company data if the API is unavailable
- HTML template includes OTP code, expiry notice, contact details, office locations, and social media icon links
- Uses `nodemailer` with Gmail service + App Password authentication

---

### `utils/otp.js`

Cryptographic OTP utilities:

- **`generateOtp()`** — generates a cryptographically random 6-digit number using `crypto.randomInt`
- **`hashOtp(otp, userId)`** — creates an HMAC-SHA256 hash of `userId:otp` using `OTP_SECRET` — ties the OTP to the specific user so it cannot be reused across accounts
- **`timingSafeEqual(a, b)`** — constant-time string comparison using `crypto.timingSafeEqual` to prevent timing attacks
- **`parseEspoDate(str)`** — converts EspoCRM datetime format (`YYYY-MM-DD HH:mm:ss`) to a JavaScript `Date`
- **`formatEspoDate(date)`** — converts a JavaScript `Date` back to EspoCRM datetime format

---

### `utils/revalidateFrontends.js`

Triggers Next.js ISR (Incremental Static Regeneration) revalidation after any data write:

- **`revalidateFrontends()`** — POSTs to `FRONTEND_URL/api/revalidate` and optionally `FRONTEND_B_REVALIDATE_URL` in parallel using `Promise.allSettled` (failures are silently ignored so they never block a write operation)
- Called automatically by `createRecord`, `updateRecord`, and `deleteRecord` in `genericController.js`

---

## Deployment (Vercel)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.example` in the Vercel dashboard
4. Deploy — Vercel uses `vercel.json` to route all requests to `index.js`

For background jobs (cache warmer, IndexNow scheduler) on Vercel, set `RUN_STARTUP_JOBS=true`. Note that serverless functions are stateless — the in-memory cache resets on each cold start.

---

## Scripts

```bash
npm start          # Start the server
npm run dev        # Same as start (for local development)
npm run lint       # Run ESLint
npm run lint:fix   # Auto-fix ESLint issues
npm run build      # Lint + run build validation checks
npm run deploy:check  # Same as build
```

---

## Security Notes

- Never commit `.env` — it is in `.gitignore`
- OTP codes are never stored in plain text — only HMAC-SHA256 hashes
- All OTP comparisons use timing-safe equality to prevent timing attacks
- `helmet` sets security headers on every response
- CORS is explicitly configured — wildcard `*` is never used
- Error details are hidden in production (`NODE_ENV=production`)
