#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ARTHA AI — One-command development setup
# Run from repository root: bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ARTHA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail() { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }

log "ARTHA AI — Development Setup"
log "================================"

# ── Node version check ────────────────────────────────────────────────────────
REQUIRED_NODE="20"
CURRENT_NODE=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")

if [ "$CURRENT_NODE" -lt "$REQUIRED_NODE" ]; then
  fail "Node.js >= ${REQUIRED_NODE} required. Current: $(node -v 2>/dev/null || echo 'not installed')"
fi
log "Node.js version: $(node -v) ✓"

# ── npm install ───────────────────────────────────────────────────────────────
log "Installing dependencies..."
npm install
log "Dependencies installed ✓"

# ── .env setup ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  log "Creating .env from .env.example..."
  cp .env.example .env

  # Generate JWT_SECRET
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  # Generate WEBHOOK_SECRET
  WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  # Replace placeholders in .env
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/REPLACE_WITH_64_CHAR_HEX_SECRET_MINIMUM_32_CHARS/${JWT_SECRET}/" .env
    sed -i '' "s/REPLACE_WITH_WEBHOOK_SECRET_MINIMUM_16_CHARS/${WEBHOOK_SECRET}/" .env
  else
    sed -i "s/REPLACE_WITH_64_CHAR_HEX_SECRET_MINIMUM_32_CHARS/${JWT_SECRET}/" .env
    sed -i "s/REPLACE_WITH_WEBHOOK_SECRET_MINIMUM_16_CHARS/${WEBHOOK_SECRET}/" .env
  fi

  warn ".env created with generated secrets."
  warn "Update DATABASE_URL and REDIS_URL if using custom hosts."
else
  log ".env already exists — skipping ✓"
fi

# ── PostgreSQL check ──────────────────────────────────────────────────────────
log "Checking PostgreSQL..."
if command -v psql &> /dev/null; then
  log "PostgreSQL client found ✓"

  # Attempt to create DB + user if they don't exist
  if psql -U postgres -c '\q' 2>/dev/null; then
    psql -U postgres -tc "SELECT 1 FROM pg_user WHERE usename='artha'" | grep -q 1 || \
      psql -U postgres -c "CREATE USER artha WITH PASSWORD 'artha_dev';" 2>/dev/null || true

    psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='artha_dev'" | grep -q 1 || \
      psql -U postgres -c "CREATE DATABASE artha_dev OWNER artha;" 2>/dev/null || true

    log "Database artha_dev ready ✓"
  else
    warn "Cannot connect as postgres superuser — create DB manually:"
    warn "  createdb artha_dev"
    warn "  psql artha_dev -c \"CREATE USER artha WITH PASSWORD 'artha_dev';\""
    warn "  psql artha_dev -c \"GRANT ALL PRIVILEGES ON DATABASE artha_dev TO artha;\""
  fi
else
  warn "psql not found — install PostgreSQL and create artha_dev database manually"
fi

# ── Redis check ───────────────────────────────────────────────────────────────
log "Checking Redis..."
if command -v redis-cli &> /dev/null; then
  if redis-cli ping &> /dev/null; then
    log "Redis running ✓"
  else
    warn "Redis not running. Start with: redis-server"
  fi
else
  warn "redis-cli not found — install Redis"
fi

# ── Run migrations ────────────────────────────────────────────────────────────
log "Running database migrations..."
npm run migrate 2>/dev/null && log "Migrations complete ✓" || warn "Migration failed — ensure DB is running and .env is configured"

# ── Run tests ─────────────────────────────────────────────────────────────────
log "Running unit tests (no DB/Redis required)..."
npx jest tests/unit/ --no-coverage --silent 2>/dev/null && log "Unit tests passed ✓" || warn "Some unit tests failed — check output"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
log "Setup complete!"
echo ""
echo "  Start dev server:   npm run dev"
echo "  Run all tests:      npm test"
echo "  Run unit tests:     npm run test:unit"
echo "  Run migrations:     npm run migrate"
echo "  Check health:       curl http://localhost:3000/health"
echo ""