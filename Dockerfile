FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3030
ENV HOST=0.0.0.0

EXPOSE 3030

CMD ["npm", "run", "start"]