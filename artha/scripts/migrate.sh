#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ARTHA AI — Migration runner wrapper
# Usage:
#   bash scripts/migrate.sh           — apply pending migrations
#   bash scripts/migrate.sh down      — rollback last migration
#   bash scripts/migrate.sh status    — show migration status
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[MIGRATE]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC}    $1"; exit 1; }

COMMAND="${1:-up}"

# Validate command
if [[ "$COMMAND" != "up" && "$COMMAND" != "down" && "$COMMAND" != "status" ]]; then
  fail "Unknown command: $COMMAND. Usage: migrate.sh [up|down|status]"
fi

# Verify .env exists
if [ ! -f .env ]; then
  fail ".env not found. Run: bash scripts/setup.sh"
fi

# Load .env
set -a
source .env
set +a

log "Running: npm run migrate:${COMMAND}"
echo ""

case "$COMMAND" in
  up)
    npm run migrate
    ;;
  down)
    npm run migrate:down
    ;;
  status)
    npm run migrate:status
    ;;
esac

log "Done."