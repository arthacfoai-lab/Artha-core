#!/bin/bash
echo "🔧 Final ARTHA Structure Setup..."

# Directories
mkdir -p apps/api/src/middleware apps/api/src/routes/v1
mkdir -p apps/api/src/engines/{routing,understanding,accounting,gst,validation,memory,intelligence,auth}
mkdir -p apps/api/src/validators
mkdir -p apps/worker/src/handlers apps/scheduler/src/jobs
mkdir -p packages/database/src/{migrations,repositories,queries}
mkdir -p packages/queue/src/queues packages/validators/src/schemas
mkdir -p services/{ocr,reporting,notifications} workers infra/{docker,nginx,postgres,redis}
mkdir -p docs scripts tests/unit/{accounting,auth,understanding} tests/integration tests/fixtures

# All individual files
touch apps/api/package.json apps/api/src/server.js apps/api/src/app.js
touch apps/api/src/middleware/trace.middleware.js apps/api/src/middleware/auth.middleware.js
touch apps/api/src/middleware/tenant.middleware.js apps/api/src/middleware/webhook.middleware.js
touch apps/api/src/middleware/request-logger.middleware.js apps/api/src/middleware/error.middleware.js

touch apps/api/src/routes/system.routes.js
touch apps/api/src/routes/v1/index.js apps/api/src/routes/v1/auth.routes.js apps/api/src/routes/v1/accounting.routes.js
touch apps/api/src/routes/v1/gst.routes.js apps/api/src/routes/v1/message.routes.js apps/api/src/routes/v1/reminder.routes.js
touch apps/api/src/routes/v1/vendor.routes.js apps/api/src/routes/v1/customer.routes.js apps/api/src/routes/v1/report.routes.js
touch apps/api/src/routes/v1/webhook.routes.js

touch apps/api/src/engines/routing/routing.engine.js
touch apps/api/src/engines/understanding/understanding.engine.js apps/api/src/engines/understanding/intent.types.js
touch apps/api/src/engines/understanding/language.detector.js apps/api/src/engines/understanding/entity.extractor.js

touch apps/api/src/engines/accounting/accounting.engine.js apps/api/src/engines/accounting/journal.engine.js
touch apps/api/src/engines/accounting/ledger.engine.js apps/api/src/engines/accounting/balance.engine.js
touch apps/api/src/engines/accounting/reconciliation.engine.js apps/api/src/engines/accounting/chart-of-accounts.js

touch apps/api/src/engines/gst/gst.engine.js apps/api/src/engines/gst/calculator.engine.js
touch apps/api/src/engines/gst/itc.engine.js apps/api/src/engines/gst/filing.engine.js
touch apps/api/src/engines/gst/validator.engine.js apps/api/src/engines/gst/rates.js

touch apps/api/src/engines/validation/validation.engine.js apps/api/src/engines/validation/approval.engine.js
touch apps/api/src/engines/validation/rules.js

touch apps/api/src/engines/memory/memory.engine.js apps/api/src/engines/memory/vendor.engine.js
touch apps/api/src/engines/memory/customer.engine.js apps/api/src/engines/memory/pattern.engine.js

touch apps/api/src/engines/intelligence/intelligence.engine.js apps/api/src/engines/intelligence/pnl.engine.js
touch apps/api/src/engines/intelligence/cashflow.engine.js apps/api/src/engines/intelligence/runway.engine.js
touch apps/api/src/engines/intelligence/alert.engine.js

touch apps/api/src/engines/auth/auth.engine.js apps/api/src/engines/auth/token.service.js
touch apps/api/src/engines/auth/password.service.js

touch apps/api/src/validators/common.validator.js apps/api/src/validators/auth.validator.js
touch apps/api/src/validators/journal.validator.js apps/api/src/validators/gst.validator.js
touch apps/api/src/validators/vendor.validator.js apps/api/src/validators/customer.validator.js

touch apps/worker/package.json apps/worker/src/worker.js
touch apps/worker/src/handlers/ocr.handler.js apps/worker/src/handlers/gst.handler.js
touch apps/worker/src/handlers/reporting.handler.js apps/worker/src/handlers/notification.handler.js
touch apps/worker/src/handlers/reminder.handler.js apps/worker/src/handlers/ai.handler.js

touch apps/scheduler/package.json apps/scheduler/src/scheduler.js
touch apps/scheduler/src/jobs/gst-deadline.job.js apps/scheduler/src/jobs/reminder-dispatch.job.js
touch apps/scheduler/src/jobs/report-generation.job.js

# Packages
touch packages/config/package.json packages/config/src/index.js packages/config/src/env.schema.js
touch packages/logger/package.json packages/logger/src/index.js
touch packages/errors/package.json packages/errors/src/index.js
touch packages/session/package.json packages/session/src/index.js
touch packages/queue/package.json packages/queue/src/index.js packages/queue/src/client.js
touch packages/queue/src/queues/ocr.queue.js packages/queue/src/queues/gst.queue.js
touch packages/queue/src/queues/reporting.queue.js packages/queue/src/queues/notification.queue.js
touch packages/queue/src/queues/reminder.queue.js
touch packages/validators/package.json packages/validators/src/index.js
touch packages/validators/src/schemas/pagination.schema.js packages/validators/src/schemas/money.schema.js
touch packages/validators/src/schemas/gstin.schema.js

# Database
touch packages/database/package.json packages/database/src/index.js packages/database/src/client.js
touch packages/database/src/migrations/runner.js packages/database/src/migrations/001_core_foundation.js
touch packages/database/src/migrations/002_vendors_customers.js packages/database/src/migrations/003_reports.js
touch packages/database/src/migrations/004_ocr_jobs.js
touch packages/database/src/repositories/base.repository.js packages/database/src/repositories/company.repository.js
touch packages/database/src/repositories/user.repository.js packages/database/src/repositories/ledger.repository.js
touch packages/database/src/repositories/journal.repository.js packages/database/src/repositories/audit.repository.js
touch packages/database/src/repositories/gst.repository.js packages/database/src/repositories/reminder.repository.js
touch packages/database/src/repositories/vendor.repository.js packages/database/src/repositories/customer.repository.js
touch packages/database/src/repositories/report.repository.js
touch packages/database/src/queries/ledger.queries.js packages/database/src/queries/journal.queries.js
touch packages/database/src/queries/report.queries.js

# Rest
touch services/ocr/README.md services/reporting/README.md services/notifications/README.md
touch workers/README.md
touch infra/docker/api.Dockerfile infra/docker/worker.Dockerfile infra/docker/scheduler.Dockerfile
touch infra/nginx/nginx.conf infra/postgres/init.sql infra/redis/redis.conf infra/docker-compose.yml infra/docker-compose.prod.yml
touch docs/architecture.md docs/api.md docs/engines.md docs/gst-rules.md docs/deployment.md docs/day-by-day.md
touch scripts/setup.sh scripts/migrate.sh scripts/seed.sh scripts/generate-secrets.sh scripts/health-check.sh
touch .env.example .gitignore .eslintrc.js .prettierrc package.json

echo "🎉 FINAL STRUCTURE COMPLETE!"
tree -L 3
