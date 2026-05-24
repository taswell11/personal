# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies required for build scripts)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Run build compilation script to compile Vite assets and bundle Express backend
RUN npm run build

# Stage 2: Production execution stage
FROM node:20-alpine AS runner

WORKDIR /app

# Set node environment production variable
ENV NODE_ENV=production

# Cloud Run sets PORT automatically, fallback to 3000
ENV PORT=3000

# Copy dependency manifests for runtime dependencies
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy compiled resources (frontend assets in dist/ & bundled server in dist/server.cjs) from the builder stage
COPY --from=builder /app/dist ./dist

# Inform Docker that the container listens on port 3000 by default (dynamically overridden in Cloud Run environment)
EXPOSE 3000

# Start Express platform process
CMD ["npm", "run", "start"]
