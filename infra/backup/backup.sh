#!/bin/sh
set -eu

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="/tmp/paperclip-$ts.sql.gz"

echo "[backup $ts] dumping..."
pg_dump --no-owner --no-acl "$PGDATABASE" | gzip -9 > "$file"

bytes="$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")"
echo "[backup $ts] dump size: $bytes bytes"
if [ "$bytes" -lt 1024 ]; then
  echo "[backup $ts] dump suspiciously small; aborting upload"
  exit 1
fi

echo "[backup $ts] authenticating to B2..."
b2 account authorize "$B2_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null

remote_key="paperclip/$(date -u +%Y/%m)/paperclip-$ts.sql.gz"
echo "[backup $ts] uploading to b2://$B2_BUCKET/$remote_key ..."
b2 file upload "$B2_BUCKET" "$file" "$remote_key" >/dev/null

echo "[backup $ts] pruning > 14 days..."
b2 ls --recursive --json "$B2_BUCKET" "paperclip/" | \
  python3 -c '
import json, sys, datetime
cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=14)
for line in sys.stdin:
    line=line.strip()
    if not line or line == "[" or line == "]" or line.endswith(","): continue
    try:
        f = json.loads(line.rstrip(","))
    except: continue
    ts = datetime.datetime.utcfromtimestamp(f["uploadTimestamp"]/1000)
    if ts < cutoff:
        print(f["fileName"])
' | while read -r name; do
  if [ -n "$name" ]; then
    b2 file delete "$B2_BUCKET/$name" >/dev/null || true
    echo "  pruned: $name"
  fi
done

rm -f "$file"
echo "[backup $ts] done"
