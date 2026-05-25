FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Companion services are defined in services/docker-compose.services.yml:
#   - Scanner (Python/FastAPI) on port 7001
#   - Executor (Rust/axum) on port 7003
#   - Orchestrator (Go/net-http) on port 7002
# Configure via environment variables:
#   SCANNER_SERVICE_URL, EXECUTOR_SERVICE_URL, ORCHESTRATOR_SERVICE_URL

CMD ["node", "dist/index.js"]
