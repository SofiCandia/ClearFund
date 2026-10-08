#!/bin/sh
set -eu

mkdir -p "$(dirname "$DATABASE_URL")" "$EVIDENCE_STORAGE_DIR"
chown node:node "$(dirname "$DATABASE_URL")" "$EVIDENCE_STORAGE_DIR"

if [ -f "$DATABASE_URL" ]; then
  chown node:node "$DATABASE_URL"
fi

for sqlite_sidecar in "${DATABASE_URL}-wal" "${DATABASE_URL}-shm"; do
  if [ -f "$sqlite_sidecar" ]; then
    chown node:node "$sqlite_sidecar"
  fi
done

exec gosu node "$@"
