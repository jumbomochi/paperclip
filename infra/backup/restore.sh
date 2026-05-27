#!/bin/sh
# Restore the latest backup from B2 into the local Postgres.
# WARNING: drops + recreates the target database.
set -eu

if [ -z "${B2_BUCKET-}" ] || [ -z "${PGDATABASE-}" ]; then
  echo "B2_BUCKET and PGDATABASE required"; exit 1
fi

b2 account authorize "$B2_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null
latest="$(b2 ls --recursive --json "$B2_BUCKET" "paperclip/" | \
  python3 -c '
import json, sys
files=[]
for line in sys.stdin:
    line=line.strip()
    if not line or line in ("[","]") or line.endswith(","): continue
    try: f=json.loads(line.rstrip(","))
    except: continue
    files.append(f)
files.sort(key=lambda f: f["uploadTimestamp"])
print(files[-1]["fileName"] if files else "")')"

if [ -z "$latest" ]; then
  echo "no backups found"; exit 1
fi

echo "Latest: $latest"
echo "About to drop+recreate $PGDATABASE on $PGHOST. Press Ctrl-C to abort."
sleep 5

b2 file download "$B2_BUCKET/$latest" /tmp/restore.sql.gz
gunzip -f /tmp/restore.sql.gz
psql -h "$PGHOST" -U "$PGUSER" -d postgres <<SQL
DROP DATABASE IF EXISTS "$PGDATABASE";
CREATE DATABASE "$PGDATABASE";
SQL
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f /tmp/restore.sql
rm -f /tmp/restore.sql
echo "Restore complete"
