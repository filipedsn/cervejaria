# Quiver Tap — imagem de staging/prod para VPS (Node 24)
# Build a partir da raiz do monorepo: docker build -f deploy/tap-quiver/Dockerfile .

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build:deploy

FROM node:24-bookworm-slim AS backend-build
WORKDIR /src/backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci
COPY backend/ ./
RUN npx prisma generate && npm run build:deploy

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r quiver && useradd -r -g quiver quiver

COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=backend-build /src/backend/dist ./dist
COPY --from=frontend-build /src/frontend/dist ./frontend-dist

ENV FRONTEND_DIST=/app/frontend-dist
ENV UPLOADS_DIR=/app/uploads
ENV PORT=3001
ENV HOST=0.0.0.0
# Staging no VPS: sem collector local
ENV OTEL_TRACES_EXPORTER=none
ENV OTEL_METRICS_EXPORTER=none
ENV OTEL_LOGS_EXPORTER=none

RUN mkdir -p /app/uploads && chown -R quiver:quiver /app
USER quiver
EXPOSE 3001
CMD ["node", "dist/index.js"]
