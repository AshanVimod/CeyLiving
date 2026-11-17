#!/usr/bin/env bash
# B14 (backend plan 17.4): one nightly backup. Dumps the database (custom format), checks the dump can be read back
# (pg_restore reads it in full), encrypts it to the age public key and uploads it to the backup bucket with a SHA-256 file
# beside it. The plain dump never touches a disk: it is streamed from pg_dump to age, and only the encrypted file is
# written to /tmp (memory). The private key is not on the server: only the restore drill (or a real restore) has it.
# Retention (30 days) is the bucket's lifecycle rule (docs/runbook.md, "Backups").
#
# Settings (env/backup.env):
#   DATABASE_BACKUP_URL     the schema owner's direct (unpooled) connection: it can read every table, pgboss included
#   BACKUP_AGE_RECIPIENT    the age public key (age1...)
#   BACKUP_BUCKET           the backup bucket, e.g. ceyliving-backups (not the uploads bucket)
#   RCLONE_CONFIG_R2_*      the bucket's S3 settings: TYPE=s3, PROVIDER=Cloudflare, ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY
#   BACKUP_ENVIRONMENT      set by docker-compose.yml (the compose project), part of the object name
#   BACKUP_MIN_TABLES       optional: a dump with fewer tables is a failure (default 20; the schema has more)
# Exit 0 only when the upload is complete and checked. Logs one JSON line per step; never a URL or a key.
set -euo pipefail

log() { printf '{"msg":"%s"%s}\n' "$1" "${2:+,$2}"; }
fail() {
  log "backup.failed" "\"step\":\"$1\""
  exit 1
}

: "${DATABASE_BACKUP_URL:?DATABASE_BACKUP_URL is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] || fail "recipient"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "bucket"
environment="${BACKUP_ENVIRONMENT:-ceyliving}"
[[ "$environment" =~ ^[a-z0-9-]{1,40}$ ]] || fail "environment"

started=$(date +%s)
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
key="${environment}/$(date -u +%Y/%m/%d)/${stamp}.dump.age"
work=$(mktemp -d /tmp/backup.XXXXXX)
trap 'rm -rf "$work"' EXIT

# Dump -> age, while a copy is read back in full by pg_restore (rendered as SQL, every data block decompressed) and its
# tables counted: a dump that is cut short, unreadable or nearly empty fails here. pipefail fails on any stage.
pg_dump --format=custom --compress=6 --dbname="$DATABASE_BACKUP_URL" |
  tee >(
    pg_restore --file=- 2>"$work/check.err" | grep -c '^CREATE TABLE ' >"$work/tables.txt"
    echo "${PIPESTATUS[0]}" >"$work/check.status"
  ) |
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/backup.age" ||
  fail "dump"

# The check reads its copy in parallel; wait for it to finish (at most 2 minutes after the dump).
for _ in $(seq 1 240); do [[ -s "$work/check.status" ]] && break; sleep 0.5; done
[[ "$(cat "$work/check.status" 2>/dev/null)" == "0" ]] || fail "dump_unreadable"
tables=$(cat "$work/tables.txt")
((tables >= ${BACKUP_MIN_TABLES:-20})) || fail "dump_too_small"

bytes=$(stat -c %s "$work/backup.age")
sha=$(sha256sum "$work/backup.age" | cut -d' ' -f1)
echo "$sha  ${stamp}.dump.age" >"$work/backup.age.sha256"

remote="r2:${BACKUP_BUCKET}/${key}"
rclone copyto "$work/backup.age" "$remote" --s3-no-check-bucket --retries 3 || fail "upload"
rclone copyto "$work/backup.age.sha256" "${remote}.sha256" --s3-no-check-bucket --retries 3 ||
  fail "upload_checksum"
# rclone already compares MD5 on a single-part upload; also confirm the stored size.
stored=$(rclone lsjson "$remote" --s3-no-check-bucket | grep -o '"Size":[0-9]*' | cut -d: -f2)
[[ "$stored" == "$bytes" ]] || fail "verify"

log "backup.done" "\"key\":\"$key\",\"bytes\":$bytes,\"tables\":$tables,\"sha256\":\"$sha\",\"seconds\":$(($(date +%s) - started))"
