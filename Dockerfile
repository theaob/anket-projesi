# Node 22.13+ is required for the built-in node:sqlite module.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# The SQLite database lives in /app/data/anket.db; mount a volume here to keep
# polls and results across container restarts and image updates.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
