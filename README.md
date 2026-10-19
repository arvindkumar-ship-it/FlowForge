# FlowForge

Self-hosted visual workflow automation with an original deterministic execution engine. No embedded n8n, Node-RED, Temporal or agent framework.

**Release status: 0.1 foundation.** This repository contains a working vertical slice, not the complete enterprise platform described in the master build spec. Distributed Tier L scaling, OAuth/SSO/MFA, schedules, native AI agents and other unshipped gates are listed in [docs/BACKLOG.md](docs/BACKLOG.md). Do not represent the 10M executions/day target as a measured capability.

## Run locally

Requires Node 22.23 or later in the Node 22 family and npm. PowerShell, macOS and Linux use the same scripts.

```powershell
git clone https://github.com/arvindkumar-ship-it/FlowForge.git
cd FlowForge
npm ci --ignore-scripts
npm run setup
npm run dev
```

Open `http://localhost:5173`, create the owner account, and create a workflow. The starter graph has a manual trigger and a mapping step. Click **Execute workflow**, supply a JSON array of items, and inspect the persisted node outputs. Do owner setup while the instance is accessible only locally.

`npm run setup` creates `.env` only if it does not exist. Keep the generated `VAULT_KEY` in a separate secure backup. Losing it makes stored credentials unrecoverable. Do not replace the key to fix a boot error.

## Included

- Visual canvas: add, connect, move and configure eight node types; JSON import/export, immutable version history, optimistic save conflicts and mobile read-only view.
- Original stable DAG traversal, branch fan-out, append merge, per-item expressions, filtering, bounded data mapping, public HTTP requests, failures and durable wait/resume.
- AST allowlist expression compiler: no eval, Function, vm, ambient globals or function calls. Expressions start with `=` and can read `$json`, `$itemIndex`, `$execution.id`.
- SQLite WAL/FULL durable queue, atomic admission/idempotency, fencing tokens, per-node checkpoints, expired-lease recovery, crash cap, cancellation and transactionally recorded state events.
- Encrypted AES-256-GCM credentials with credential-ID AAD; exact-host authorization, TLS-only credential dispatch, reflected token redaction and metadata-only listing.
- Salted scrypt passwords, hashed HTTP-only session tokens, strict cookies, origin checks, rate limits, owner/editor/viewer checks, project isolation and audit metadata.
- Workflow, execution, credential, insights, users, project and settings views. Metrics in Insights are real execution aggregates. Displayed duration includes queue/wait time.

## Runtime boundaries

This is a **single-host** runtime. Run one application process with its SQLite file on a local persistent disk. Concurrency defaults to four async execution slots. It is not a PostgreSQL/Redis distributed deployment. Outbox rows are durable local events; there is no external event relay yet. Audit is local metadata, not an immutable compliance log.

Jobs are acknowledged only after the database transaction commits. After a process crash, an expired 90-second lease can be reclaimed. Execution starts and external effects are **at least once**: a crash after a remote API call but before its checkpoint can replay that node. HTTP nodes send a deterministic `Idempotency-Key`; the downstream API must implement deduplication. Three expired claims mark an execution crashed. Manual jobs are preferred, but there are no independently scaled queue bulkheads or tenant fairness guarantees yet.

Limits: 200 nodes, 500 edges, 10,000 items/node, 4 MiB output/node, 16 MiB total checkpoint output, 512 KiB API body, 60-second running segment, 15-second HTTP request, 1 MiB HTTP response, 5-second DNS deadline, 30-day maximum wait. The default queued-job high-water mark is 1,000. Admission returns `503` with `Retry-After: 5` when full. Checkpoint writes happen per node and are not tuned for high throughput.

HTTP nodes accept public IPv4 HTTP(S) destinations on ports 80/443, pin DNS at connection time and refuse redirects. IPv6 destinations and arbitrary code nodes are intentionally unavailable. An independent outbound firewall is recommended. Webhook URLs are public capability URLs; activating a webhook exposes `POST /webhooks/<workflow-id>`. Manual triggers cannot be activated.

## Configuration

See [.env.example](.env.example). `PUBLIC_ORIGIN` must exactly match the browser origin, including scheme and port. Production HTTPS requires `COOKIE_SECURE=true`. The default bind address is loopback. Preserve the vault key across restarts and deployments. Never commit `.env`, databases, tokens or exports containing sensitive input/output.

For the production static bundle:

```powershell
npm run build
# Set PUBLIC_ORIGIN=http://localhost:3001 in .env for this local mode.
npm start
```

The API serves `dist/web` on port 3001. Unknown API paths return 404. Deploy behind a TLS reverse proxy and finish owner setup before allowing remote access.

## Container

```powershell
npm run setup
# In .env, set PUBLIC_ORIGIN to the URL you will open (e.g. http://localhost:3001).
docker compose up --build -d
```

The container runs as a non-root user with a read-only root filesystem, dropped capabilities and a persistent data volume. Keep one replica. Health endpoints are `/health/live` and `/health/ready`. Container build must be verified on your Docker host; it was not validated in the build workspace.

## Verification

```powershell
npm run check
npm run test:coverage
npm audit --audit-level=moderate
npx playwright install chromium
npm run test:e2e
```

The E2E test uses a dedicated local test owner and creates workflows. Set `DATABASE_PATH` to a test database before running it. CI uses an ephemeral database and a public, test-only vault key. Screenshots go to `artifacts/visual`; coverage, browser traces and dependencies are ignored by Git. See [docs/design-review/foundation.md](docs/design-review/foundation.md) for the actual visual review scope.

## Backup and recovery

Stop the application cleanly before copying the database and its WAL/SHM companions, or use SQLite's online backup facility. Back up the vault key separately. Restore to an isolated instance first, verify readiness, sign-in, workflow history, credentials and a non-side-effecting execution, then switch traffic. A copied database without its matching key cannot decrypt credentials. Automated PITR, restore drills, retention and cold storage are future gates.

Architecture decisions are in [docs/adr/0001-foundation.md](docs/adr/0001-foundation.md). MIT licensed; dependency licensing is recorded in [docs/dependencies.md](docs/dependencies.md).
