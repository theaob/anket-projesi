# Node 22.13+ is required for the built-in node:sqlite module.

# Dependencies are plain JavaScript (no native modules), so they are installed
# once on the build machine's own platform and copied into every target
# image. Running npm inside the arm64 image under QEMU emulation is very slow
# and can hang the multi-platform build.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
# Creates /app/data without a RUN step, so nothing executes under emulation.
# The SQLite database lives in /app/data/anket.db; mount a volume there to
# keep polls and results across container restarts and image updates.
WORKDIR /app/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
