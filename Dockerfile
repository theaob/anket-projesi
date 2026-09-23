# Node 22.13+ is required for the built-in node:sqlite module.
FROM node:22-alpine
# su-exec lets the entrypoint drop from root to the "node" user.
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# The SQLite database lives in /app/data/anket.db; mount a volume here to keep
# polls and results across container restarts and image updates.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" > /dev/null || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
