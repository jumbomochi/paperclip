#!/bin/sh
set -eu
HOST="${1:-https://agency.example.com}"

echo "Checking $HOST..."
curl -fsS "$HOST/api/health" >/dev/null && echo "  /api/health ✓"
curl -fsS "$HOST/health" >/dev/null && echo "  /health (attribution) ✓"
echo "All ok."
