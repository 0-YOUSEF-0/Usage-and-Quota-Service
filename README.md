# Usage Metering and Quota Service

A TypeScript and Express API backed by PostgreSQL for tracking account and user consumption against monthly quotas.

The service evaluates each consumption request against both the user's plan and the account's plan. Accepted requests update both usage counters in a database transaction. Rejected requests are recorded without deducting units.

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Run with Docker Compose](#run-with-docker-compose)
  - [Run Locally](#run-locally)
- [Configuration](#configuration)
- [Plans and Quotas](#plans-and-quotas)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [How Consumption Works](#how-consumption-works)
- [Database and Migrations](#database-and-migrations)
- [Testing](#testing)
- [Demo Client](#demo-client)
- [Performance Testing](#performance-testing)
- [Limitations](#limitations)

## Features

- API-key authentication for account-scoped endpoints.
- SHA-256 hashing for stored API keys; the plaintext key is returned only when an account is created.
- Predefined plans and account-owned custom plans.
- Separate monthly usage counters for accounts and users.
- UTC calendar-month tracking, with previous months retained.
- Per-request and monthly quota checks at both the user and account levels.
- Atomic usage updates through PostgreSQL transactions.
- Consistent account-first, user-second usage-row locking during consumption.
- Idempotent consumption requests using a `requestId`.
- Request history for accepted and rejected decisions, including snapshots of the limits applied.
- Account isolation for users and custom plans.
- Database migrations run during application startup.
- Automated tests, a demo client, and a load-testing script.

## Technology Stack

- **Runtime:** Node.js 22
- **Language:** TypeScript
- **API:** Express 5
- **Database:** PostgreSQL 16
- **Database client:** `pg`
- **Validation:** Zod
- **Testing:** Vitest and Supertest
- **Containers:** Docker and Docker Compose
- **Load testing:** Autocannon

## Project Structure

```text
.
├── client/                 # Demo HTTP client
├── migrations/             # SQL schema and seed migrations
├── perf/
│   ├── run.mjs             # Load-test runner
│   └── results/            # Saved benchmark results
├── src/
│   ├── auth/               # API-key generation and hashing
│   ├── config/             # Application constants
│   ├── database/           # Pool, migrations, transactions
│   ├── domain/             # UTC month and quota rules
│   ├── http/               # Validation and error handling
│   ├── middleware/         # API-key authentication
│   ├── routes/             # HTTP endpoints
│   └── services/           # Consumption and plan-access logic
├── tests/                  # API and domain tests
├── api-helper.ps1          # PowerShell API helper
├── docker-compose.yml
├── Dockerfile
├── package.json
└── vitest.config.ts
```

## Getting Started

### Prerequisites

For the Docker setup, install Docker Desktop with Docker Compose. For local development without Docker, install Node.js 22 or a compatible version, npm, and PostgreSQL.

### Run with Docker Compose

From the project root, run:

```powershell
docker compose up --build
```

This starts PostgreSQL and the API. The API runs pending migrations during startup. The demo client runs after the API health check succeeds and prints examples of consumption decisions.

To run the database and API in the background without automatically running the demo client:

```powershell
docker compose up --build -d app
```

Check the health endpoint:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Run the demo client separately:

```powershell
docker compose run --rm client
```

Stop the services:

```powershell
docker compose down
```

To also delete the database volume and its data:

```powershell
docker compose down -v
```

> **Warning:** `docker compose down -v` permanently deletes the PostgreSQL data stored in the Compose volume.

### Run Locally

Install dependencies:

```powershell
npm ci
```

Start the PostgreSQL database using Docker Compose:

```powershell
docker compose up -d database
```

Set the connection string in PowerShell:

```powershell
$env:DATABASE_URL = "postgres://metering:metering_dev_password@localhost:5432/metering"
```

Start the development server:

```powershell
npm run dev
```

The server runs pending migrations before listening. The default port is `3000`.

To build and run the compiled application:

```powershell
npm run build
npm start
```

Make sure `DATABASE_URL` is set before starting the application.

## Configuration

| Variable | Purpose | Default / Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required by the application |
| `PORT` | HTTP port | `3000` |
| `DB_POOL_MAX` | Maximum PostgreSQL pool connections | `10` |
| `POSTGRES_DB` | PostgreSQL database name in Docker Compose | `metering` |
| `POSTGRES_USER` | PostgreSQL username in Docker Compose | `metering` |
| `POSTGRES_PASSWORD` | PostgreSQL password in Docker Compose | `metering_dev_password` |

The `.env.example` file provides example settings for Docker Compose. If you change the PostgreSQL credentials, make sure the connection string used by the application and tests matches them.

> **Security:** The credentials shown above are development defaults. Use secure credentials outside local development, and never commit a real `.env` file or secrets to Git.

## Plans and Quotas

The database seeds four predefined plans:

| Plan | Intended use | Monthly limit | Maximum per request |
|---|---|---:|---:|
| Starter | Default account plan | 10,000 units | 100 units |
| Pro | Higher account limit | 100,000 units | 1,000 units |
| Basic | Default user plan | 500 units | 20 units |
| Premium | Higher user limit | 5,000 units | 200 units |

New accounts receive the Starter plan. New users receive the Basic plan unless another plan is specified when creating the user.

Accounts can create custom plans that belong only to the account that created them. Predefined plans are shared and read-only through the API. Custom plan names are unique within an account, ignoring case, and cannot reuse a predefined plan name.

Changing a plan does not reset existing usage. Editing a custom plan changes the limits used for future decisions. Request history retains snapshots of the limits that applied to each recorded decision.

## Authentication

Account creation (`POST /accounts`) and the health endpoint do not require an API key. Other API endpoints require this header:

```http
X-API-Key: mk_your_api_key
```

The API key is returned only when the account is created. Save it securely. The database stores its SHA-256 hash, not the plaintext key.

Requests are scoped to the account identified by the API key. A client cannot access another account's data by supplying a different account ID.

## API Reference

The API runs at `http://localhost:3000` by default. JSON request bodies are expected for the endpoints that create or update resources.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/health` | No | Check API and database availability |
| `POST` | `/accounts` | No | Create an account and return its API key |
| `GET` | `/account` | Yes | Get the account, plan, and current-month usage |
| `PUT` | `/account/plan` | Yes | Assign a plan to the account |
| `GET` | `/plans` | Yes | List predefined and account-owned custom plans |
| `GET` | `/plans/:planId` | Yes | Get a visible plan |
| `POST` | `/plans` | Yes | Create a custom plan |
| `PATCH` | `/plans/:planId` | Yes | Edit an account-owned custom plan |
| `POST` | `/users` | Yes | Create a user |
| `GET` | `/users` | Yes | List users with pagination |
| `GET` | `/users/:externalId` | Yes | Get a user and current-month usage |
| `PUT` | `/users/:externalId/plan` | Yes | Assign a plan to a user |
| `POST` | `/consume` | Yes | Evaluate and record a consumption request |
| `GET` | `/usage` | Yes | Get account and user usage |
| `GET` | `/history` | Yes | List consumption history |

### Create an Account

```http
POST /accounts
Content-Type: application/json
```

```json
{
  "name": "Acme Corporation"
}
```

A successful response has status `201` and includes the account information and an API key. Store the key securely because the API does not return it again.

### Create a User

```http
POST /users
X-API-Key: mk_your_api_key
Content-Type: application/json
```

```json
{
  "externalId": "user-123",
  "name": "Sara"
}
```

`externalId` is an identifier supplied by the calling application and must be unique within the account. If `planId` is omitted, the user receives the Basic plan.

### Create a Custom Plan

```http
POST /plans
X-API-Key: mk_your_api_key
Content-Type: application/json
```

```json
{
  "name": "Document Team",
  "description": "Plan for document processing",
  "monthlyLimit": 20000,
  "maxUnitsPerRequest": 250
}
```

The description is optional. Limits must be positive integers and cannot exceed `1,000,000,000,000`.

### Consume Units

```http
POST /consume
X-API-Key: mk_your_api_key
Content-Type: application/json
```

```json
{
  "externalId": "user-123",
  "units": 10,
  "requestId": "document-job-0001"
}
```

`requestId` is required and should identify one logical consumption operation. Reuse the same ID when retrying that operation.

A quota decision returns HTTP `200` whether it is accepted or rejected. Check the `accepted` property in the JSON response.

Example accepted response:

```json
{
  "requestId": "document-job-0001",
  "accepted": true,
  "units": 10,
  "month": "2026-10-01",
  "rejection": null,
  "user": {
    "externalId": "user-123",
    "planId": "user-plan-id",
    "planName": "Basic",
    "monthlyLimit": 500,
    "maxUnitsPerRequest": 20,
    "unitsUsed": 10,
    "remaining": 490
  },
  "account": {
    "planId": "account-plan-id",
    "planName": "Starter",
    "monthlyLimit": 10000,
    "maxUnitsPerRequest": 100,
    "unitsUsed": 10,
    "remaining": 9990
  },
  "replayed": false
}
```

The plan IDs above are illustrative. Actual IDs are returned by the API. A rejected decision has `accepted: false`; its `rejection` object identifies the failed level and rule and includes a message.

### Usage and History Filters

`GET /usage` supports:

| Query parameter | Purpose |
|---|---|
| `month=YYYY-MM` | Select a UTC calendar month; defaults to the current UTC month |
| `page` | Page number, starting at `1` |
| `pageSize` | Page size from `1` to `100` (default `20`) |

`GET /history` supports:

| Query parameter | Purpose |
|---|---|
| `month=YYYY-MM` | Filter by UTC calendar month |
| `externalId=user-123` | Filter by user |
| `accepted=true` or `accepted=false` | Filter by decision |
| `page` | Page number, starting at `1` (default `1`) |
| `pageSize` | Page size from `1` to `100` (default `20`) |

History is returned newest first.

### Common HTTP Errors

| Status | Meaning |
|---|---|
| `400` | Invalid input or an unavailable plan assignment |
| `401` | Missing, malformed, or unknown API key |
| `403` | Attempt to modify a predefined read-only plan |
| `404` | User or plan not found within the authenticated account |
| `409` | Duplicate user/plan name or conflicting reuse of a request ID |
| `503` | Health check cannot reach the database |

Error responses include an `error` object with a machine-readable code and a message.

## How Consumption Works

For each valid consumption request, the service checks these rules in order:

1. Requested units do not exceed the user's per-request limit.
2. Requested units do not exceed the account's per-request limit.
3. The user has enough monthly allowance remaining.
4. The account has enough monthly allowance remaining.

The first failing rule determines the rejection. A rejected request does not increase either usage counter. An accepted request updates both counters and records the decision in one database transaction.

### Monthly Usage

Usage is stored separately for each account or user and UTC calendar month. A month is represented by its first day (for example, `2026-10-01`). A new month gets a separate usage row, while earlier months remain available for reporting.

The main usage-related tables are:

- `account_usage` — monthly usage totals for each account.
- `user_usage` — monthly usage totals for each user.
- `request_history` — accepted and rejected consumption decisions, including snapshots of the limits applied.

### Idempotency and Concurrency

Each `requestId` is unique within an account. Retrying the same ID with the same user and unit count returns the original decision without counting usage twice. Reusing an ID with different request details returns `409 request_id_conflict`.

Consumption is performed in a database transaction. The service locks the account usage row first and the user usage row second, using a consistent lock order. A uniqueness constraint on `(account_id, request_id)` also prevents duplicate history entries for the same account request ID.

## Database and Migrations

SQL migrations are stored in `migrations/`:

- `001_create_schema.sql` creates the core tables, constraints, and indexes.
- `002_seed_predefined_plans.sql` inserts the predefined plans.

At startup, `src/database/migrate.ts` creates the `schema_migrations` table if needed, applies migrations that have not run yet, and records their filenames. A PostgreSQL advisory lock prevents multiple application instances from running migrations at the same time.

## Testing

The project uses Vitest and Supertest. The API tests require a reachable PostgreSQL database and run migrations.

Start the local database:

```powershell
docker compose up -d database
```

Run the tests:

```powershell
npm test
```

The default local test connection is:

```text
postgres://metering:metering_dev_password@localhost:5432/metering
```

If your database uses different credentials, set `DATABASE_URL` before running the tests:

```powershell
$env:DATABASE_URL = "postgres://your_user:your_password@localhost:5432/your_database"
npm test
```

The test suite covers API-key authentication, account isolation, quota rules, input validation, idempotent retries, concurrent consumption, plan changes, request history, and UTC month boundaries.

Build the TypeScript project with:

```powershell
npm run build
```

## Demo Client

The demo client in `client/demo.mjs` uses the HTTP API to demonstrate accepted consumption, quota rejections, plan changes, retries, and request history.

Run it with Docker Compose:

```powershell
docker compose run --rm client
```

The `api-helper.ps1` file also provides an `Api` PowerShell helper for sending HTTP requests to `http://localhost:3000` with an `X-API-Key` header.

## Performance Testing

The load-test runner is `perf/run.mjs`. It uses Autocannon to test two scenarios:

- **Many accounts:** 10 accounts with 5 users each.
- **Single account:** 1 account with 50 users.

The default settings are 20 concurrent connections and 15 seconds per scenario. The script checks that account usage matches user usage totals and accepted history records. Results are written to `perf/results/<label>.md`.

Run the benchmark while the API and database are running:

```powershell
npm run perf -- baseline
```

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `API_URL` | `http://localhost:3000` | API base URL |
| `DURATION` | `15` | Test duration in seconds |
| `CONNECTIONS` | `20` | Number of concurrent connections |

### Saved Benchmark Results

The following values are from the benchmark result files included in the project. They are measurements from that run environment, not performance guarantees.

| Run | Scenario | Requests/sec | Average latency | p99 latency | Non-2xx | Errors | Counts correct |
|---|---|---:|---:|---:|---:|---:|---|
| `baseline` | Many accounts | 269 | 73.8 ms | 131 ms | 0 | 0 | Yes |
| `baseline` | Single account | 92 | 216.23 ms | 404 ms | 0 | 0 | Yes |
| `improved-roundtrips` | Many accounts | 292 | 67.73 ms | 119 ms | 0 | 0 | Yes |
| `improved-roundtrips` | Single account | 93 | 212.85 ms | 672 ms | 0 | 0 | Yes |

The saved results show better throughput in the many-account scenario for `improved-roundtrips`. Single-account throughput is similar, while the recorded p99 latency is higher. Run the benchmark on your own machine before drawing conclusions about performance.

## Limitations

- Billing, payments, and refunds are out of scope.
- There is no end-user login or role-based access system; the API key is the account-level credential.
- Usage reports show the plan limits currently in effect, including for historical usage months. Request history retains snapshots of the limits applied to individual decisions.

## License

The package metadata specifies the ISC license. Add a `LICENSE` file if you intend to distribute the project under that license.
