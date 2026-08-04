FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN chown -R node:node /app

ENV PORT=3030
ENV HOST=0.0.0.0

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3030/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["npm", "run", "start"]