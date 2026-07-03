# 🦎 Lizard

**AI-native, zero-config data console for your Postgres fleet.**

Point Lizard at one or many Postgres databases and get:

- **Auto-generated CRUD UI** — browse, filter, edit every table across every schema and database, derived entirely from schema introspection. Zero configuration.
- **Natural-language querying** — ask "top 10 customers by orders last month" and get the answer as a table, with the generated SQL always shown. Works across databases.
- **One-click & prompt-driven charts** — visualize any result, or describe a chart in words. A single chart can join data living in different microservice databases.
- **Dashboards** — save charts as panels; each panel may pull from different databases.

Lizard treats a fleet of Postgres databases (the microservices reality) as a single queryable surface: reads and analytics can span databases via an embedded read-only federation engine (DuckDB), while writes always target exactly one owning database.

## Quickstart (demo)

```bash
npm install
docker compose up -d        # two demo microservice DBs (users + orders)
export ANTHROPIC_API_KEY=sk-ant-…   # enables AI querying & prompt charts
npm run dev                 # → http://localhost:3111
```

Then add the two demo connections in the UI (or against your own databases):

| Field | users demo | orders demo |
|---|---|---|
| Name | `users_service` | `orders_service` |
| Host / Port | `localhost` / `54321` | `localhost` / `54322` |
| Database | `users_service` | `orders_service` |
| Read user / password | `lizard_read` / `lizard_read` | `lizard_read` / `lizard_read` |
| Write user / password | `lizard_write` / `lizard_write` | `lizard_write` / `lizard_write` |

The connection **name** doubles as the database alias in cross-database SQL (`users_service.public.customers`), so it must be a lowercase identifier.

## Provisioning credentials on your own databases

Lizard wants **two roles per database, least privilege** (a connection may register with only a read role → read-only mode):

```sql
-- run as a superuser on each service database
CREATE ROLE lizard_read LOGIN PASSWORD '…';
CREATE ROLE lizard_write LOGIN PASSWORD '…';

GRANT USAGE ON SCHEMA public TO lizard_read, lizard_write;   -- repeat per schema
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lizard_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lizard_write;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO lizard_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lizard_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lizard_write;
```

Lizard **never issues DDL against your databases** and never stores anything in them — all Lizard state (connections, overrides, virtual relationships, saved queries, dashboards, audit log) lives in its own local SQLite file (`./data/lizard.sqlite`, configurable via `LIZARD_METADATA_PATH`).

## Security model

The AI can *generate* SQL but can never act outside the sandbox:

1. **Read-only role**: AI/chart/browse queries run on the `lizard_read` role. Writes (CRUD forms only) use `lizard_write` with parameterized queries — model SQL never reaches a write-capable connection.
2. **SQL Guard**: every AI/chart/federated query is parsed and validated — single `SELECT` only; multi-statements, DML/DDL, comments, `pg_sleep`, file/dblink/backend-control functions, sequence manipulation, row locking, `COPY`, and (on the federation path) `ATTACH`/`INSTALL`/file readers are all rejected. A hard `LIMIT` wrapper caps every result.
3. **Belt and suspenders**: guarded queries additionally run inside `BEGIN TRANSACTION READ ONLY` with a 10s `statement_timeout`; federation attaches every database `READ_ONLY` and locks DuckDB's configuration + filesystem access before model SQL runs.
4. **Transparency**: the generated SQL and the set of databases touched are always shown in the UI, and everything is recorded in the audit log.
5. **Adversarial test suite**: `npm test` runs 30+ injection/escape vectors against the guard (`tests/guard/`).

## Cross-database queries (how federation works)

Postgres can join across schemas natively but not across separate databases. For questions and charts that span connections, Lizard spins up an embedded DuckDB, `ATTACH`es each involved Postgres database read-only with its `lizard_read` credentials, runs one SQL statement across them (filters are pushed down), and returns the result. No `postgres_fdw`, no DDL, nothing installed on your databases.

Since microservice databases have no real foreign keys between them, you can declare **virtual relationships** (e.g. `orders.customer_id → users_service.public.customers.id`) in the table "Customize" panel. These power cross-database reference labels/pickers in the UI and are given to the AI as join hints.

## Configuration

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | enables AI querying and prompt-driven charts |
| `LIZARD_AI_MODEL` | model for text-to-SQL (default `claude-sonnet-5`) |
| `LIZARD_METADATA_PATH` | metadata SQLite location (default `./data/lizard.sqlite`) |

## Development

```bash
npm run dev      # dev server on :3111
npm test         # guard adversarial suite + core integration tests (needs docker compose up -d)
npm run build    # production build
```

Architecture, subsystem design, and the phased plan live in [PLAN.md](PLAN.md).
