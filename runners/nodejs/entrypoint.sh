#!/bin/sh
set -eu

RUN_FILE="${RUN_FILE:-/workspace/main.js}"
STDIN_FILE="${STDIN_FILE:-/workspace/stdin.txt}"
RUN_TIMEOUT_SECONDS="${RUN_TIMEOUT_SECONDS:-30}"

# Best-effort network shutdown for local Docker runs. The runtime also uses --network none.
iptables -P OUTPUT DROP 2>/dev/null || true

exec gosu runner node /app/runner.js \
  --run-file "$RUN_FILE" \
  --stdin-file "$STDIN_FILE" \
  --timeout "$RUN_TIMEOUT_SECONDS"
