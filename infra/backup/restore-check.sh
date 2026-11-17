#!/usr/bin/env bash
# B14 (17.4): the inside of the restore drill (infra/backup/restore-drill.sh starts it). Fetches one backup, checks
# its SHA-256, decrypts it with the private key mounted at /run/age/identity, restores it into the throwaway
# database at DRILL_DATABASE_URL and checks what came back. Never points at a live database: the drill passes the
# address of a container it just created. Prints one JSON report line.
#   restore-check.sh latest | <object key under the bucket>
set -euo pipefail

log() { printf '{"msg":"%s"%s}\n' "$1" "${2:+,$2}"; }
fail() {
  log "drill.failed" "\"step\":\"$1\""
  exit 1
}

: "${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is not set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
[[ -r /run/age/identity ]] || fail "identity"
which="${1:-latest}"
prefix="${BACKUP_ENVIRONMENT:-}"
work=$(mktemp -d /tmp/drill.XXXXXX)
trap 'rm -rf "$work"' EXIT
started=$(date +%s)

if [[ "$which" == "latest" ]]; then
  # Object names start with the date and time, so the last one in name order is the newest.
  which=$(rclone lsf -R --files-only --include '*.dump.age' "r2:${BACKUP_BUCKET}/${prefix}" | sort | tail -1)
  [[ -n "$which" ]] || fail "no_backup_found"
  [[ -n "$prefix" ]] && which="${prefix}/${which}"
fi
[[ "$which" =~ ^[A-Za-z0-9/_.:-]+\.dump\.age$ ]] || fail "object_name"

rclone copyto "r2:${BACKUP_BUCKET}/${which}" "$work/backup.age" || fail "download"
rclone copyto "r2:${BACKUP_BUCKET}/${which}.sha256" "$work/backup.age.sha256" || fail "download_checksum"
expected=$(cut -d' ' -f1 "$work/backup.age.sha256")
actual=$(sha256sum "$work/backup.age" | cut -d' ' -f1)
[[ "$expected" == "$actual" ]] || fail "checksum"
bytes=$(stat -c %s "$work/backup.age")

age --decrypt --identity /run/age/identity --output "$work/backup.dump" "$work/backup.age" || fail "decrypt"
# Owners and grants name the provider's roles; a drill checks the data, so both are left out (runbook: a real
# restore into the provider keeps them).
restore_started=$(date +%s)
pg_restore --no-owner --no-acl --exit-on-error --dbname="$DRILL_DATABASE_URL" "$work/backup.dump" || fail "restore"
restore_seconds=$(($(date +%s) - restore_started))

q() { psql "$DRILL_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
migration=$(q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1") ||
  fail "migrations_table"
counts=$(q "SELECT json_build_object(
  'users', (SELECT count(*) FROM users),
  'shops', (SELECT count(*) FROM shops),
  'products', (SELECT count(*) FROM products),
  'orders', (SELECT count(*) FROM orders),
  'payments', (SELECT count(*) FROM payments),
  'audit_log', (SELECT count(*) FROM audit_log),
  'pgboss_jobs', (SELECT count(*) FROM pgboss.job))::text") || fail "row_counts"

log "drill.done" "\"object\":\"$which\",\"bytes\":$bytes,\"sha256\":\"ok\",\"restore_seconds\":$restore_seconds,\"total_seconds\":$(($(date +%s) - started)),\"latest_migration\":\"$migration\",\"rows\":$counts"
