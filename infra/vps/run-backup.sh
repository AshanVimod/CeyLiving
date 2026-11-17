#!/usr/bin/env bash
# B14 (17.4, OPS-07): the nightly backup of one environment, started by ceyliving-backup@<environment>.timer.
# Runs the backup container with the image of the current deploy, then records the outcome as the `backup`
# checkpoint through the app (worker image, app user), which the admin Operations card shows and OPS-06 alerts on
# (failed, or no success for 26 hours). Exit status = the backup's.
set -uo pipefail

environment="${1:-}"
[[ "$environment" =~ ^(staging|production)$ ]] || { echo "usage: run-backup.sh staging|production" >&2; exit 2; }
root="${CEYLIVING_ROOT:-/opt/ceyliving}/$environment"
current="$root/.deploy/current.env"
[[ -f "$current" ]] || { echo '{"msg":"backup.failed","step":"no_deploy_yet"}'; exit 1; }
set -a
# shellcheck source=/dev/null
. "$current" # CEYLIVING_IMAGE, CEYLIVING_BACKUP_IMAGE
set +a

dc() { docker compose --project-directory "$root" -f "$root/docker-compose.yml" -p "ceyliving-$environment" "$@"; }

dc --profile ops run --rm --no-deps backup
status=$?
outcome=$([[ $status -eq 0 ]] && echo ok || echo failed)

dc run --rm --no-deps --entrypoint node worker --conditions=react-server dist/ops-checkpoint.mjs backup "$outcome" ||
  echo '{"msg":"backup.checkpoint_failed"}' # the overdue alert still fires after 26 hours
exit $status
