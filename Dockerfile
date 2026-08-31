FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder

ENV NODE_ENV=production

COPY . .
RUN npm run build:nas

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=192
ENV UV_THREADPOOL_SIZE=2

COPY --from=builder --chown=node:node /app/dist/nas ./

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/favicon.svg').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["node", "server.mjs"]
