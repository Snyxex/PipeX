#!/usr/bin/env bash
set -euo pipefail

service="${1:-}"
mode="${2:-}"

case "$service:$mode" in
  node20-ci:quality|node22-ci:quality|node24-ci:quality|audit-ci:audit|github-consumer-ci:github-consumer|node24-ci:artifact) ;;
  *)
    echo "Unsupported Jenkins job: $service $mode" >&2
    exit 2
    ;;
esac

: "${COMPOSE_FILE:=.ci/jenkins-compose.yml}"

if [[ "$mode" != "artifact" ]]; then
  tar \
    --exclude=.git \
    --exclude=.artifacts \
    --exclude=.npm \
    --exclude=dist \
    --exclude=node_modules \
    -cf - . \
    | docker compose -f "$COMPOSE_FILE" run --rm -T "$service" tar -xf - -C /workspace
fi

if [[ "$mode" == "quality" ]]; then
  command='npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund
test "$(npm --version)" = "11.16.0"
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
test -f dist/index.mjs
test -f dist/index.d.mts
npm run test:tooling
npm run test:unit
npm run test:integration
npm run test:security
npm run test:package:built
npm run test:consumer:built
npm run test:performance:built'
elif [[ "$mode" == "audit" ]]; then
  command='npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund
test "$(npm --version)" = "11.16.0"
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm audit --audit-level=high'
elif [[ "$mode" == "github-consumer" ]]; then
  if [[ -n "${CHANGE_ID:-}" ]]; then
    reference="refs/pull/${CHANGE_ID}/head"
  else
    reference="$(git rev-parse HEAD)"
  fi
  if [[ ! "$reference" =~ ^[0-9a-f]{40}$ && ! "$reference" =~ ^refs/pull/[0-9]+/head$ ]]; then
    echo 'Refusing unsafe GitHub dependency reference.' >&2
    exit 2
  fi
  command='npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund
test "$(npm --version)" = "11.16.0"
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run test:consumer:github'
else
  command='npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund
test "$(npm --version)" = "11.16.0"
node --version
npm --version
test -f dist/index.mjs
test -f dist/index.d.mts
rm -rf .artifacts
mkdir .artifacts
npm pack --json --ignore-scripts --pack-destination .artifacts >/tmp/pipex-pack.json
shopt -s nullglob
packages=(.artifacts/*.tgz)
test "${#packages[@]}" -eq 1'
fi

if [[ "$mode" == "github-consumer" ]]; then
  docker compose -f "$COMPOSE_FILE" run --rm -T \
    -e "PIPEX_GITHUB_INSTALL_SPEC=github:Snyxex/PipeX#$reference" \
    "$service" bash -lc "set -euo pipefail
$command"
else
  docker compose -f "$COMPOSE_FILE" run --rm -T "$service" bash -lc "set -euo pipefail
$command"
fi
