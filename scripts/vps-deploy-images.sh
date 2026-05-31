#!/bin/bash
# Legacy alias — use scripts/vps-deploy.sh instead.
# Pulls GHCR images, restarts stack, runs db:sync-stock.
#
# Usage:
#   export REGISTRY_OWNER=<github-user-lowercase>
#   bash scripts/vps-deploy-images.sh

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/vps-deploy.sh" --pull "$@"
