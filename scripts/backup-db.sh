#!/usr/bin/env bash
# Local logical backup of the Supabase database.
#
# The Free plan includes no managed backups, which turned a disk-full crash into
# an unrecoverable one. pg_dump costs nothing and runs anywhere.
#
# Needs SUPABASE_DB_URL in .env.local - the pooler connection string from
# Dashboard -> Project Settings -> Database -> Connection string (URI). It is a
# direct Postgres URL and is NOT the same as NEXT_PUBLIC_SUPABASE_URL.
#
#   ./scripts/backup-db.sh                  # schema + data
#   ./scripts/backup-db.sh --schema-only    # structure only, fast
#
# Restore into a fresh project with:
#   psql "$SUPABASE_DB_URL" < backups/<file>.sql

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  # shellcheck disable=SC1090
  source <(grep -E '^SUPABASE_DB_URL=' .env.local | sed 's/^/export /')
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set. Add it to .env.local:" >&2
  echo '  SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres"' >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install with: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

mkdir -p backups

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
if [ "${1:-}" = "--schema-only" ]; then
  OUT="backups/schema-${STAMP}.sql"
  EXTRA="--schema-only"
else
  OUT="backups/full-${STAMP}.sql"
  EXTRA=""
fi

echo "Dumping to ${OUT} ..."

# --no-owner/--no-privileges keep the dump restorable into a different project,
# where role names differ.
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-privileges \
  --schema=public \
  ${EXTRA} \
  --file "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "Done: ${OUT} (${SIZE})"

# Keep the 7 most recent of each kind so this can run on a schedule unattended.
ls -1t backups/full-*.sql 2>/dev/null | tail -n +8 | xargs -r rm --
ls -1t backups/schema-*.sql 2>/dev/null | tail -n +8 | xargs -r rm --
