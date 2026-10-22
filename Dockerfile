# syntax=docker/dockerfile:1

FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# One image serves the API, Socket.IO and the built React app. PostgreSQL and
# Redis are installed only for the free all-in-one mode (docker/entrypoint.sh).
FROM node:22-alpine
RUN apk add --no-cache postgresql16 redis tini
ENV NODE_ENV=production \
    PORT=10000 \
    CLIENT_DIST=/app/client/dist \
    PATH="/usr/libexec/postgresql16:${PATH}"
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY --from=client /app/client/dist ./client/dist
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
EXPOSE 10000
ENTRYPOINT ["/sbin/tini", "--", "entrypoint.sh"]
CMD ["node", "server/src/index.js"]
