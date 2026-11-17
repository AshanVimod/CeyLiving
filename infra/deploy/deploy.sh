#!/usr/bin/env bash
# B14 (backend plan 17.3): deploys one image tag to one environment on the VPS. The deploy workflow reaches it over
# SSH through the Cloudflare tunnel; the deploy key's authorized_keys line forces this script with the environment
# fixed, so the key can do nothing else:
#   command="/opt/ceyliving/bin/deploy.sh production",restrict ssh-ed25519 AAAA... deploy-production
# The workflow then sends one of (as the SSH command, read from SSH_ORIGINAL_COMMAND):
#   deploy <40-hex commit>-<environment>    pull, migrate, switch, check, warm up
#   rollback                                switch back to the previous tag (no migration: DB-11)
#   status                                  print the current and previous tags
# By hand on the server: deploy.sh production deploy <tag>   (docs/runbook.md, "Deploy" and "Rollback").
#
# Order (the B14 acceptance criterion): the new image's migrate step runs BEFORE web and worker are switched. If it
# fails, nothing is switched. If the new version isn't healthy (/api/ready) in time, the previous tag is started
# again: migrations are expand-only (DB-11), so the previous version works with the migrated database.
set -euo pipefail

ROOT_BASE="${CEYLIVING_ROOT:-/opt/ceyliving}"
WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-180}"

log() { printf '{"msg":"%s"%s}\n' "$1" "${2:+,$2}"; }
die() {
  log "deploy.failed" "\"environment\":\"${environment:-}\",\"step\":\"$1\""
  exit "${2:-1}"
}

environment="${1:-}"
[[ "$environment" =~ ^(staging|production)$ ]] || die "environment" 2
shift
if [[ $# -eq 0 && -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  # Split the SSH command into words; nothing in it is ever evaluated.
  read -r -a args <<<"$SSH_ORIGINAL_COMMAND"
  set -- "${args[@]}"
fi
action="${1:-status}"

root="$ROOT_BASE/$environment"
state="$root/.deploy"
[[ -f "$root/docker-compose.yml" ]] || die "no_compose_file"
[[ -f "$root/deploy.conf" ]] || die "no_deploy_conf"
# deploy.conf: CEYLIVING_REGISTRY=ghcr.io/<owner> (images <registry>/ceyliving and <registry>/ceyliving-backup)
registry=$(sed -n 's/^CEYLIVING_REGISTRY=\([a-z0-9./_-]*\)$/\1/p' "$root/deploy.conf")
[[ -n "$registry" ]] || die "registry"
mkdir -p "$state"

dc() { docker compose --project-directory "$root" -f "$root/docker-compose.yml" -p "ceyliving-$environment" "$@"; }
image_of() { sed -n 's/^CEYLIVING_IMAGE=//p' "$1" 2>/dev/null; }

# One deploy at a time per environment (mkdir is atomic).
lock="$state/lock"
mkdir "$lock" 2>/dev/null || die "another_deploy_running"
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

# Starts web, worker and the tunnel on the image in $1 and waits until web is healthy.
# Then checks the worker: it has no health check (no HTTP), so `--wait` counts it as up as soon as it runs, even when
# it exits at once on a bad setting and restarts in a loop. It must still be running, never restarted, a little later.
switch_to() {
  CEYLIVING_IMAGE="$1" CEYLIVING_BACKUP_IMAGE="$2" dc up -d --no-deps --wait --wait-timeout "$WAIT_SECONDS" \
    web worker cloudflared || return 1
  sleep "${WORKER_SETTLE_SECONDS:-20}"
  local worker restarts running
  worker=$(CEYLIVING_IMAGE="$1" CEYLIVING_BACKUP_IMAGE="$2" dc ps -q worker)
  [[ -n "$worker" ]] || return 1
  read -r restarts running < <(docker inspect -f '{{.RestartCount}} {{.State.Running}}' "$worker")
  if [[ "$restarts" != "0" || "$running" != "true" ]]; then
    log "deploy.worker_not_stable" "\"restarts\":\"$restarts\",\"running\":\"$running\""
    return 1
  fi
}

remember() { printf 'CEYLIVING_IMAGE=%s\nCEYLIVING_BACKUP_IMAGE=%s\n' "$1" "$2" >"$3"; }

warm() {
  # Not fatal: the new version already serves; a slow or failed warm-up only means slower first visits.
  dc exec -T web node /app/ops/warm.mjs http://127.0.0.1:3000 || log "deploy.warm_skipped"
}

case "$action" in
  status)
    log "deploy.status" "\"environment\":\"$environment\",\"current\":\"$(image_of "$state/current.env")\",\"previous\":\"$(image_of "$state/previous.env")\""
    ;;

  deploy)
    tag="${2:-}"
    [[ "$tag" =~ ^[0-9a-f]{40}-(staging|production)$ ]] || die "tag" 2
    [[ "${tag##*-}" == "$environment" ]] || die "tag_environment" 2
    image="$registry/ceyliving:$tag"
    backup_image="$registry/ceyliving-backup:${tag%-*}"
    log "deploy.start" "\"environment\":\"$environment\",\"tag\":\"$tag\""

    docker pull --quiet "$image" >/dev/null || die "pull"
    docker pull --quiet "$backup_image" >/dev/null || die "pull_backup"

    # The server's compose file must be the one this image was built with (it may add a service or a setting).
    shipped=$(docker run --rm --network none --entrypoint cat "$image" /app/deploy/docker-compose.yml) || die "read_compose"
    [[ "$shipped" == "$(cat "$root/docker-compose.yml")" ]] ||
      die "compose_file_differs: copy docker-compose.yml from this commit to $root (runbook, Deploy)"

    # 1. Migrations first, with the new image. On failure nothing has been switched.
    CEYLIVING_IMAGE="$image" CEYLIVING_BACKUP_IMAGE="$backup_image" dc run --rm --no-deps migrate || die "migrate"
    log "deploy.migrated" "\"tag\":\"$tag\""

    # 2. Switch, and wait for /api/ready.
    if ! switch_to "$image" "$backup_image"; then
      previous=$(image_of "$state/current.env")
      if [[ -n "$previous" ]]; then
        log "deploy.switching_back" "\"to\":\"${previous##*:}\""
        switch_to "$previous" "$(sed -n 's/^CEYLIVING_BACKUP_IMAGE=//p' "$state/current.env")" || die "switch_back"
      fi
      die "not_ready"
    fi

    [[ -f "$state/current.env" ]] && cp "$state/current.env" "$state/previous.env"
    remember "$image" "$backup_image" "$state/current.env"
    log "deploy.switched" "\"environment\":\"$environment\",\"tag\":\"$tag\""
    warm
    log "deploy.done" "\"environment\":\"$environment\",\"tag\":\"$tag\""
    ;;

  rollback)
    [[ -f "$state/previous.env" ]] || die "no_previous_version"
    previous=$(image_of "$state/previous.env")
    previous_backup=$(sed -n 's/^CEYLIVING_BACKUP_IMAGE=//p' "$state/previous.env")
    log "deploy.rollback" "\"environment\":\"$environment\",\"to\":\"${previous##*:}\""
    switch_to "$previous" "$previous_backup" || die "rollback_not_ready"
    cp "$state/current.env" "$state/rolled-back.env"
    cp "$state/previous.env" "$state/current.env"
    warm
    log "deploy.done" "\"environment\":\"$environment\",\"tag\":\"${previous##*:}\""
    ;;

  *)
    die "unknown_action" 2
    ;;
esac
