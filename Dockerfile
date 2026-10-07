# syntax=docker/dockerfile:1

# ---- Build: type-check and bundle the client into dist/ ----
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

# ---- Runtime: production dependencies + server source + built client ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server imports the shared game code from src/, so it ships alongside the build.
COPY --from=build /app/dist ./dist
COPY src ./src
COPY server ./server

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8787) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "server/index.ts", "--prod"]
