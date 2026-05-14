'use strict';

/**
 * Migration 001 — ARTHA Core Foundation Tables
 *
 * Creates all core tables for the ARTHA financial platform.
 *
 * Tables:
 *   companies        — multi-tenant root (one row = one business)
 *   users            — tenant-scoped users with RBAC roles
 *   ledgers          — chart of accounts (double-entry backbone)
 *   journal_entries  — APPEND ONLY financial transaction records
 *   journal_lines    — APPEND ONLY debit/credit lines per entry
 *   gst_transactions — GST records per journal entry
 *   reminders        — Paperclip-managed reminder events
 *   audit_logs       — IMMUTABLE compliance audit trail
 *
 * CRITICAL RULES encoded in schema:
 *   1. Every table has company_id — multi-tenant isolation
 *   2. journal_entries has NO updated_at, NO deleted_at — append-only
 *   3. journal_lines has NO updated_at, NO deleted_at — append-only
 *   4. audit_logs has NO updated_at, NO deleted_at — immutable
 *   5. All monetary amounts are BIGINT (paise) — never FLOAT or DECIMAL
 *   6. UUIDs everywhere — no serial integer primary keys
 *   7. Soft deletes (deleted_at) on non-financial tables
 *   8. Reversals via reversal_of FK — not UPDATE/DELETE on journal_entries
 */

const up = `

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Companies (multi-tenant root) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255)  NOT NULL,
  gstin           VARCHAR(15),
  pan             VARCHAR(10),
  business_type   VARCHAR(50),
  phone           VARCHAR(20),
  email           VARCHAR(255),
  address         JSONB         NOT NULL DEFAULT '{}',
  settings        JSONB         NOT NULL DEFAULT '{}',
  plan            VARCHAR(50)   NOT NULL DEFAULT 'trial',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_gstin
  ON companies(gstin)
  WHERE gstin IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_companies_active
  ON companies(is_active)
  WHERE deleted_at IS NULL;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name            VARCHAR(255)  NOT NULL,
  phone           VARCHAR(20),
  email           VARCHAR(255),
  role            VARCHAR(50)   NOT NULL DEFAULT 'owner',
  password_hash   TEXT,
  whatsapp_id     VARCHAR(100),
  telegram_id     VARCHAR(100),
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_company
  ON users(company_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_company
  ON users(email, company_id)
  WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp
  ON users(whatsapp_id)
  WHERE whatsapp_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram
  ON users(telegram_id)
  WHERE telegram_id IS NOT NULL AND deleted_at IS NULL;

-- ── Ledgers (Chart of Accounts) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledgers (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name            VARCHAR(255)  NOT NULL,
  code            VARCHAR(50),
  type            VARCHAR(50)   NOT NULL,
  sub_type        VARCHAR(50),
  parent_id       UUID          REFERENCES ledgers(id),
  is_system       BOOLEAN       NOT NULL DEFAULT FALSE,
  balance         BIGINT        NOT NULL DEFAULT 0,
  currency        CHAR(3)       NOT NULL DEFAULT 'INR',
  description     TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT ledgers_type_check
    CHECK (type IN ('asset','liability','equity','revenue','expense'))
);

CREATE INDEX IF NOT EXISTS idx_ledgers_company
  ON ledgers(company_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledgers_code_company
  ON ledgers(code, company_id)
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledgers_type
  ON ledgers(company_id, type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ledgers_subtype
  ON ledgers(company_id, sub_type)
  WHERE deleted_at IS NULL AND sub_type IS NOT NULL;

-- ── Journal Entries (APPEND ONLY) ─────────────────────────────────────────────
-- NO updated_at — entries are immutable once posted
-- NO deleted_at — entries are never deleted; use reversal_of for corrections
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  entry_date      DATE          NOT NULL,
  narration       TEXT          NOT NULL,
  reference_no    VARCHAR(100),
  source          VARCHAR(50)   NOT NULL DEFAULT 'manual',
  created_by      UUID          REFERENCES users(id),
  approved_by     UUID          REFERENCES users(id),
  status          VARCHAR(50)   NOT NULL DEFAULT 'posted',
  reversal_of     UUID          REFERENCES journal_entries(id),
  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT je_source_check
    CHECK (source IN ('manual','whatsapp','telegram','ocr','system','api')),
  CONSTRAINT je_status_check
    CHECK (status IN ('draft','posted','reversed'))
);

CREATE INDEX IF NOT EXISTS idx_je_company_date
  ON journal_entries(company_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_je_status
  ON journal_entries(company_id, status);

CREATE INDEX IF NOT EXISTS idx_je_reference
  ON journal_entries(company_id, reference_no)
  WHERE reference_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_je_created_by
  ON journal_entries(created_by)
  WHERE created_by IS NOT NULL;

-- ── Journal Lines (APPEND ONLY) ───────────────────────────────────────────────
-- NO updated_at, NO deleted_at — lines are immutable
-- amount is always POSITIVE BIGINT (paise) — type DR/CR gives direction
CREATE TABLE IF NOT EXISTS journal_lines (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  journal_entry_id  UUID          NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  ledger_id         UUID          NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
  type              CHAR(2)       NOT NULL,
  amount            BIGINT        NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT jl_type_check
    CHECK (type IN ('DR','CR')),
  CONSTRAINT jl_amount_positive
    CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_jl_entry
  ON journal_lines(journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_jl_ledger
  ON journal_lines(ledger_id);

CREATE INDEX IF NOT EXISTS idx_jl_company
  ON journal_lines(company_id);

-- ── GST Transactions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gst_transactions (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  journal_entry_id  UUID          REFERENCES journal_entries(id),
  transaction_type  VARCHAR(50)   NOT NULL,
  gstin_party       VARCHAR(15),
  taxable_amount    BIGINT        NOT NULL DEFAULT 0,
  cgst_amount       BIGINT        NOT NULL DEFAULT 0,
  sgst_amount       BIGINT        NOT NULL DEFAULT 0,
  igst_amount       BIGINT        NOT NULL DEFAULT 0,
  cess_amount       BIGINT        NOT NULL DEFAULT 0,
  hsn_sac_code      VARCHAR(20),
  invoice_no        VARCHAR(100),
  invoice_date      DATE,
  filing_period     CHAR(7),
  return_type       VARCHAR(20),
  status            VARCHAR(50)   NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT gst_type_check
    CHECK (transaction_type IN ('sale','purchase','credit_note','debit_note')),
  CONSTRAINT gst_status_check
    CHECK (status IN ('pending','filed','amended'))
);

CREATE INDEX IF NOT EXISTS idx_gst_company_period
  ON gst_transactions(company_id, filing_period);

CREATE INDEX IF NOT EXISTS idx_gst_status
  ON gst_transactions(company_id, status);

-- ── Reminders ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  type            VARCHAR(100)  NOT NULL,
  title           TEXT          NOT NULL,
  body            TEXT,
  due_at          TIMESTAMPTZ   NOT NULL,
  channel         VARCHAR(50)   NOT NULL DEFAULT 'whatsapp',
  status          VARCHAR(50)   NOT NULL DEFAULT 'pending',
  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_status_check
    CHECK (status IN ('pending','sent','dismissed','failed'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders(company_id, due_at)
  WHERE status = 'pending';

-- ── Audit Logs (IMMUTABLE) ────────────────────────────────────────────────────
-- NO updated_at, NO deleted_at — audit logs are permanently immutable
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID          REFERENCES companies(id),
  user_id         UUID          REFERENCES users(id),
  trace_id        VARCHAR(36)   NOT NULL,
  action          VARCHAR(100)  NOT NULL,
  resource_type   VARCHAR(100),
  resource_id     UUID,
  payload         JSONB         NOT NULL DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_company
  ON audit_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_trace
  ON audit_logs(trace_id);

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_logs(resource_type, resource_id)
  WHERE resource_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON audit_logs(action, created_at DESC);

`;

const down = `
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS gst_transactions;
DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS ledgers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;
`;

module.exports = {
  id:   '001',
  name: 'core_foundation',
  up,
  down,
};