'use strict';

/**
 * User test fixtures.
 * Returns plain objects — no DB calls.
 * password_hash never included — use password.service in integration tests.
 */

let counter = 0;

function makeUser(companyId, overrides = {}) {
  counter++;
  return {
    id:           `user-fixture-uuid-${String(counter).padStart(3, '0')}-00000000001`,
    company_id:   companyId || 'company-fixture-uuid-001-0000000001',
    name:         `Test User ${counter}`,
    phone:        `8${String(8000000000 + counter)}`,
    email:        `user${counter}@fixture.artha.ai`,
    role:         'owner',
    whatsapp_id:  null,
    telegram_id:  null,
    is_active:    true,
    last_seen_at: null,
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString(),
    deleted_at:   null,
    ...overrides,
  };
}

function makeOwner(companyId, overrides = {}) {
  return makeUser(companyId, { role: 'owner', ...overrides });
}

function makeAccountant(companyId, overrides = {}) {
  return makeUser(companyId, { role: 'accountant', ...overrides });
}

function makeViewer(companyId, overrides = {}) {
  return makeUser(companyId, { role: 'viewer', ...overrides });
}

function makeInactiveUser(companyId, overrides = {}) {
  return makeUser(companyId, { is_active: false, ...overrides });
}

function resetCounter() { counter = 0; }

module.exports = {
  makeUser,
  makeOwner,
  makeAccountant,
  makeViewer,
  makeInactiveUser,
  resetCounter,
};