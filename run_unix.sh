#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "${RELAY_NO_BROWSER:-0}" != 1 ]; then
  set -- --open "$@"
fi
exec python3 v13/server.py --port "${RELAY_PORT:-8766}" "$@"
