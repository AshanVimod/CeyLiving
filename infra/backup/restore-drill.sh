#!/usr/bin/env bash
# B14 (17.4): the restore drill. Run it on your own computer (Docker needed), monthly and after any change to the
# backup set-up, then add the report line to docs/runbook.md ("Restore drill log").
#
#   infra/backup/restore-drill.sh --env-file <file> --identity <age key file> [--object latest|<key>] [--image <image>]
#
# --env-file  read access to the backup bucket: BACKUP_BUCKET, BACKUP_ENVIRONMENT (e.g. ceyliving-staging) and the
#             RCLONE_CONFIG_R2_* settings (a read-only token is enough). Never the server's env/backup.env.
# --identity  the age private key from the password manager, as a file; delete it when the drill is done.
# --image     the backup image (default ceyliving-backup:local; build it with `npm run docker:build:backup`).
# DRILL_NETWORK=<docker network>  optional: join an existing network (the local MinIO drill), instead of a new one.
#
# It starts a throwaway PostgreSQL 17 container on a private Docker network, restores the backup into it, checks it,
# prints the report and removes everything again. It never connects to a live database.
set -euo pipefail

env_file="" identity="" object="latest" image="ceyliving-backup:local"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="$2"; shift 2 ;;
    --identity) identity="$2"; shift 2 ;;
    --object) object="$2"; shift 2 ;;
    --image) image="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$env_file" ]] || { echo "--env-file <file> is required" >&2; exit 2; }
[[ -f "$identity" ]] || { echo "--identity <age key file> is required" >&2; exit 2; }

run_id="ceyliving-drill-$(date +%s)"
network="${DRILL_NETWORK:-$run_id}"
password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
cleanup() {
  docker rm -f "$run_id-db" >/dev/null 2>&1 || true
  [[ -z "${DRILL_NETWORK:-}" ]] && docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ -z "${DRILL_NETWORK:-}" ]] && docker network create --internal=false "$network" >/dev/null
docker run -d --name "$run_id-db" --network "$network" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=drill \
  postgres:17.11-alpine3.23 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$run_id-db" pg_isready -h 127.0.0.1 -U postgres -d drill >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$run_id-db" pg_isready -h 127.0.0.1 -U postgres -d drill >/dev/null || { echo "The drill database didn't start" >&2; exit 1; }

# The key file's absolute path as Docker wants it (in Git Bash on Windows, `pwd -W` gives C:/...). MSYS_NO_PATHCONV:
# Git Bash would otherwise rewrite the container paths below.
key_path="$(cd "$(dirname "$identity")" && (pwd -W 2>/dev/null || pwd))/$(basename "$identity")"
MSYS_NO_PATHCONV=1 docker run --rm --network "$network" --env-file "$env_file" \
  -e DRILL_DATABASE_URL="postgresql://postgres:${password}@${run_id}-db:5432/drill" \
  -v "$key_path:/run/age/identity:ro" \
  --read-only --tmpfs /tmp:size=2g --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint bash "$image" /usr/local/bin/restore-check.sh "$object"
