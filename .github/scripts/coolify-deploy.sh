#!/usr/bin/env bash
# Deploy TejoTime apps through the Coolify API on the Hostinger VPS, then prove each one is up.
#
#   coolify-deploy.sh api web admin owner
#
# Called by .github/workflows/deploy.yml. Env: COOLIFY_URL, COOLIFY_TOKEN, UUID_<APP> (Coolify
# application UUID) and URL_<APP> (public origin) for every app named. Setup and the meaning of each
# value: docs/deploy-hostinger-coolify.md.
#
# The API goes first and alone: its Coolify pre-deployment command runs the migrations, and the web
# apps must not go live against a schema or API that is not there yet. If the API fails, nothing
# else is deployed. The web apps then deploy together, since they do not depend on each other.
set -euo pipefail

POLL_SECONDS=10
TIMEOUT_SECONDS=1800   # Next builds on a small VPS are slow; a stuck build still fails the run.

: "${COOLIFY_URL:?COOLIFY_URL secret is not set}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN secret is not set}"
COOLIFY_URL="${COOLIFY_URL%/}"

upper() { echo "$1" | tr '[:lower:]' '[:upper:]'; }

# Resolve and validate everything before touching Coolify, so a missing variable fails the run
# instead of deploying half the apps.
for app in "$@"; do
  case "$app" in api|web|admin|owner) ;; *) echo "::error::unknown app '$app' (expected api web admin owner)"; exit 1 ;; esac
  uuid_var="UUID_$(upper "$app")"; url_var="URL_$(upper "$app")"
  [ -n "${!uuid_var:-}" ] || { echo "::error::$uuid_var is empty — set COOLIFY_UUID_$(upper "$app") on this GitHub Environment"; exit 1; }
  [ -n "${!url_var:-}" ]  || { echo "::error::$url_var is empty — set $(upper "$app")_URL on this GitHub Environment"; exit 1; }
done

# Judges success by the HTTP status itself: curl's `-f` combined with `--retry` has been seen to exit
# 0 on a non-retryable 4xx (e.g. a 401 from a bad token), which would read as an empty success.
coolify() {
  local out code
  out="$(curl -sS --retry 3 --retry-delay 5 -w '\n%{http_code}' \
    -H "Authorization: Bearer $COOLIFY_TOKEN" -H "Accept: application/json" "$COOLIFY_URL/api/v1/$1")" || return 1
  code="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "Coolify API $1 → HTTP $code: $out" >&2
    return 1
  fi
  echo "$out"
}

# Prints the deployment UUID Coolify queued for this application.
trigger() {
  local app="$1" uuid_var="UUID_$(upper "$1")"
  local res dep
  res="$(coolify "deploy?uuid=${!uuid_var}&force=false")" || {
    echo "::error::Coolify API call failed for $app — check COOLIFY_URL, COOLIFY_TOKEN (deploy permission) and the app UUID" >&2
    return 1
  }
  dep="$(echo "$res" | jq -r '.deployments[0].deployment_uuid // empty')"
  if [ -z "$dep" ]; then
    echo "::error::Coolify did not queue a deployment for $app: $res" >&2
    return 1
  fi
  echo "[$app] queued deployment $dep" >&2
  echo "$dep"
}

# Blocks until the deployment finishes; non-zero if it failed, was cancelled or timed out.
wait_for() {
  local app="$1" dep="$2" waited=0 status=""
  while [ "$waited" -lt "$TIMEOUT_SECONDS" ]; do
    status="$(coolify "deployments/$dep" | jq -r '.status // "unknown"')" || status="unreachable"
    case "$status" in
      finished) echo "[$app] deployment finished"; return 0 ;;
      failed|cancelled*|error) echo "::error::[$app] Coolify deployment $dep ended as '$status' — see its log in Coolify"; return 1 ;;
    esac
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
  done
  echo "::error::[$app] deployment $dep still '$status' after ${TIMEOUT_SECONDS}s"
  return 1
}

# A finished build is not a working app: Coolify reports "finished" once the container is started.
# Retry for a while because the proxy takes a few seconds to route to the new container.
expect_up() {
  local app="$1" path="$2" url_var="URL_$(upper "$1")" code=""
  local target="${!url_var%/}$path"
  for _ in $(seq 1 18); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$target" || true)"
    if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ]; then
      echo "[$app] $target → $code"; return 0
    fi
    sleep 10
  done
  echo "::error::[$app] $target answered '$code' after deploy"
  return 1
}

check() {
  case "$1" in
    # /healthz is liveness only; /readyz is the one that proves the API can reach Postgres.
    api)   expect_up api /healthz && expect_up api /readyz ;;
    web)   expect_up web / ;;
    admin) expect_up admin /login ;;
    owner) expect_up owner /login ;;
  esac
}

rest=()
for app in "$@"; do
  [ "$app" = api ] && continue
  rest+=("$app")
done

if printf '%s\n' "$@" | grep -qx api; then
  dep="$(trigger api)"
  wait_for api "$dep"
  check api
  echo "- api: deployed and healthy" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi

[ "${#rest[@]}" -eq 0 ] && exit 0

declare -A deps
for app in "${rest[@]}"; do deps[$app]="$(trigger "$app")"; done

failed=0
for app in "${rest[@]}"; do
  if wait_for "$app" "${deps[$app]}" && check "$app"; then
    echo "- $app: deployed and healthy" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  else
    echo "- $app: **FAILED**" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    failed=1
  fi
done
exit "$failed"
