FROM node:26.5-slim AS node

FROM node AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run test
RUN npm run build

FROM node
RUN groupadd -r lizard && useradd -r -g lizard -m lizard
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3111 \
  HOSTNAME=0.0.0.0
# standalone server + static assets + public files
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /app/data && chown -R lizard:lizard /app
VOLUME /app/data
USER lizard
EXPOSE 3111
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3111/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["node", "./server.js"]
