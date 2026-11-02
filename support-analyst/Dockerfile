# Support Analyst (plantão PRD) — imagem para o VPS (Node 24).
# Build a partir desta pasta: docker build -t quiver-tap-support-analyst:staging support-analyst
# Sem dependências de runtime: só o dist compilado.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV SUPPORT_ANALYST_RUNTIME_DIR=/app/runtime
COPY package.json ./
COPY --from=build /src/dist ./dist
RUN mkdir -p /app/runtime && chown node:node /app/runtime
USER node
CMD ["node", "dist/index.js", "--watch-run"]
