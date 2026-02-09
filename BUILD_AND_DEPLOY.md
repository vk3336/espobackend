# Build and Deploy Guide

## ✅ ESLint Implementation Complete

Your project now has **ESLint** configured to catch errors before deployment!

---

## 🚀 Quick Commands

### Development

```bash
npm start              # Start the server
npm run dev            # Start in development mode
```

### Code Quality

```bash
npm run lint           # Check for errors
npm run lint:fix       # Auto-fix errors
npm run lint:report    # Generate report file
```

### Testing

```bash
npm test               # Run all tests (lint + cache test)
npm run test:cache     # Test cache functionality
```

### Build & Deploy

```bash
npm run build          # Full build check (lint + validation)
npm run validate       # Quick validation
npm run deploy:check   # Pre-deployment check
```

---

## 📋 Build Process

When you run `npm run build`, it performs:

### 1. **ESLint Check** ✅

- Checks all JavaScript files for errors
- Validates code quality
- Ensures best practices

### 2. **File Validation** ✅

- Verifies all required files exist
- Checks project structure

### 3. **Environment Check** ✅

- Validates required environment variables
- Checks optional configurations

### 4. **Dependency Check** ✅

- Ensures all packages are installed
- Verifies node_modules exists

### 5. **Syntax Check** ✅

- Tests JavaScript syntax
- Catches runtime errors

### 6. **Route Validation** ✅

- Verifies all route files exist
- Checks API structure

### 7. **Cache Validation** ✅

- Tests cache implementation
- Verifies cache functions

### 8. **Git & Security** ✅

- Checks .gitignore configuration
- Ensures .env is not committed

---

## 📊 Build Output

### Successful Build

```
🔨 Building EspoCRM API...

✅ All checks passed!
🚀 Your project is ready for deployment!

📄 Build report saved to: build-report.json
```

### Build with Warnings

```
⚠️  BUILD PASSED WITH WARNINGS

Warnings (recommended to fix):
  1. Optional environment variable not set: PORT
```

### Build Failed

```
❌ BUILD FAILED

Errors that must be fixed:
  1. Missing required file: index.js
  2. Missing environment variable: ESPO_API_KEY
```

---

## 🔧 ESLint Configuration

### What ESLint Checks

✅ **Syntax Errors**

- Undefined variables
- Missing semicolons
- Invalid code

✅ **Code Quality**

- Unused variables
- Empty catch blocks
- Unreachable code

✅ **Best Practices**

- Proper error handling
- Consistent code style
- Security issues

### ESLint Rules

The project uses these rules:

- `no-undef`: Error on undefined variables
- `no-unused-vars`: Warn on unused variables
- `no-console`: Allowed (for logging)
- `semi`: Require semicolons
- `curly`: Require curly braces
- `no-eval`: Prevent eval usage
- And more...

See `eslint.config.js` for full configuration.

---

## 📝 Build Report

After each build, a `build-report.json` file is generated:

```json
{
  "timestamp": "2024-02-09T10:30:00.000Z",
  "status": "success",
  "summary": {
    "total": 40,
    "passed": 39,
    "warnings": 1,
    "failed": 0
  },
  "checks": [...],
  "errors": [],
  "warnings": [...]
}
```

---

## 🚀 Deployment Checklist

Before deploying, ensure:

### 1. Build Passes

```bash
npm run build
```

Should exit with code 0 (success).

### 2. Environment Variables Set

Required:

- ✅ `ESPO_BASE_URL`
- ✅ `ESPO_API_KEY`
- ✅ `ESPO_ENTITIES`

Optional:

- `PORT` (default: 3000)
- `CORS_ORIGIN`
- `CACHE_REFRESH_INTERVAL_HOURS` (default: 24)

### 3. Dependencies Installed

```bash
npm install
```

### 4. Cache Test Passes

```bash
npm run test:cache
```

### 5. No ESLint Errors

```bash
npm run lint
```

---

## 🎯 Deployment Platforms

### Vercel (Recommended)

1. **Install Vercel CLI**

```bash
npm i -g vercel
```

2. **Deploy**

```bash
vercel
```

3. **Set Environment Variables**
   In Vercel dashboard:

- Add all required env vars
- Set `NODE_ENV=production`

### Heroku

1. **Create app**

```bash
heroku create your-app-name
```

2. **Set env vars**

```bash
heroku config:set ESPO_BASE_URL=your-url
heroku config:set ESPO_API_KEY=your-key
```

3. **Deploy**

```bash
git push heroku main
```

### Railway

1. **Connect GitHub repo**
2. **Add environment variables**
3. **Deploy automatically**

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t espo-api .
docker run -p 3000:3000 --env-file .env espo-api
```

---

## 🐛 Troubleshooting

### Build Fails with ESLint Errors

**Fix automatically:**

```bash
npm run lint:fix
```

**Check what's wrong:**

```bash
npm run lint
```

### Missing Dependencies

```bash
npm install
```

### Environment Variables Not Found

1. Copy `.env.example` to `.env`
2. Fill in your values
3. Run build again

### Cache Not Working

```bash
npm run test:cache
```

Should show:

```
✅ PASS: Data stored and retrieved successfully
✅ PASS: Cache miss handled correctly
✅ PASS: Cache has keys
```

---

## 📈 Performance Tips

### 1. Enable Cache

Cache is automatically enabled. Monitor with:

```bash
curl http://localhost:3000/api/cache/stats
```

### 2. Optimize Environment

Set these for production:

```env
NODE_ENV=production
CACHE_REFRESH_INTERVAL_HOURS=24
RATE_LIMIT_MAX_REQUESTS=20
```

### 3. Monitor Health

```bash
curl http://localhost:3000/health
```

---

## 🎉 You're Ready!

Your project now has:

- ✅ ESLint for code quality
- ✅ Build validation
- ✅ Cache implementation (24-hour)
- ✅ Comprehensive testing
- ✅ Deployment readiness

Run `npm run build` before every deployment to ensure everything works!

---

## 📚 Additional Resources

- **ESLint Docs**: https://eslint.org/docs/latest/
- **Node.js Best Practices**: https://github.com/goldbergyoni/nodebestpractices
- **Vercel Deployment**: https://vercel.com/docs
- **Cache Setup**: See `CACHE_SETUP.md`
- **API Reference**: See `API_REFERENCE.md`

---

## 🆘 Need Help?

1. Check build report: `build-report.json`
2. Run lint report: `npm run lint:report`
3. Check server logs
4. Review documentation files

Happy deploying! 🚀
