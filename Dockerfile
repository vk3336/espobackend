# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only the manifest files first so Docker can cache this layer
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Stage 2: final image ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Set working directory
WORKDIR /app

# Run as a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source code
COPY . .

# Make sure the non-root user owns the app files
RUN chown -R appuser:appgroup /app

USER appuser

# The port the Express server listens on (matches PORT env var default)
EXPOSE 3000

# Tell Node this is a production environment
ENV NODE_ENV=production

# Start the server
CMD ["node", "index.js"]
