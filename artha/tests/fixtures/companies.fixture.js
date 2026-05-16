'use strict';

/**
 * Company test fixtures.
 * Returns plain objects — no DB calls.
 */

let counter = 0;

function makeCompany(overrides = {}) {
  counter++;
  return {
    id:            `company-fixture-uuid-${String(counter).padStart(3, '0')}-0000000001`,
    name:          `Test Company ${counter}`,
    gstin:         `27AAAAA${String(counter).padStart(4, '0')}A1Z5`,
    pan:           `AAAAA${String(counter).padStart(4, '0')}A`,
    business_type: 'sole_proprietor',
    phone:         `9${String(9000000000 + counter)}`,
    email:         `company${counter}@fixture.artha.ai`,
    address:       { city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
    settings:      {},
    plan:          'trial',
    is_active:     true,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString(),
    deleted_at:    null,
    ...overrides,
  };
}

function makeMSME(overrides = {}) {
  return makeCompany({
    business_type: 'sole_proprietor',
    plan:          'starter',
    ...overrides,
  });
}

function makeInactiveCompany(overrides = {}) {
  return makeCompany({ is_active: false, ...overrides });
}

function resetCounter() { counter = 0; }

module.exports = { makeCompany, makeMSME, makeInactiveCompany, resetCounter };