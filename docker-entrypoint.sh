#!/bin/sh
set -e

# The server runs as the unprivileged "node" user. Data volumes created by
# v2.0.0, which ran as root, are owned by root, so when started as root hand
# the data directory over first, then drop privileges.
if [ "$(id -u)" = "0" ]; then
    chown -R node:node /app/data
    exec su-exec node "$@"
fi

exec "$@"
