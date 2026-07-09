# Lizard — Build Plan

> **One-line pitch:** Point Lizard at one or many Postgres connections and get an AI-native data console — auto-generated CRUD UI, natural-language querying, and one-click / prompt-driven charts — across every schema and database, including cross-database joins and charts, with zero manual admin-panel configuration.

> **Why multi-database is core, not a bonus:** most companies now run microservices, so their data is deliberately split across many databases and schemas (one per service). A tool that can only see one database at a time is useless to them. Lizard treats a fleet of Postgres databases as a single queryable surface — this is a primary design constraint, not a later phase.

This document is written to be handed to a strong coding model. It defines the concept, the architecture, the security model, and a phased implementation plan with concrete acceptance criteria. Build phases in order; each phase should be independently runnable and demoable.

---

## 1. Product thesis & positioning

**Thesis:** A Postgres schema already encodes ~80% of what an admin UI needs (tables, columns, types, foreign keys, constraints, enums, defaults, comments). Combine schema introspection across a *fleet* of databases with an LLM that has full multi-schema context, and you can generate the UI, answer natural-language data questions, and build charts that span services — without per-project admin-panel wiring.

**Microservices reality (drives the whole architecture):** teams split data across many Postgres databases/schemas, then need to answer questions that cross those boundaries ("orders per customer" where `orders` and `customers` live in different service databases). Answering that requires **query federation**, because Postgres cannot natively join across separate database instances (see §5.6). Lizard makes the fleet feel like one database for reads/analytics, while keeping writes scoped to the owning service DB.

**Positioning (this is the differentiator, lead with it):** *AI-native, zero-config data console.* Not "another admin panel." The competitors (Directus, NocoDB, Retool, Metabase, Supabase Studio) are config-first with AI bolted on. Lizard is AI-first, driven by the schema itself.

**In scope from the start:**
- **Multiple connections** (many Postgres databases / microservice DBs) managed side by side.
- **Multiple schemas** per connection (native cross-schema joins where they share a server).
- **Cross-database reads, joins, and charts** via a federation engine (§5.6).

**Non-goals (v1):**
- Not a low-code app builder (no drag-and-drop page composer).
- Not a BI warehouse tool (no ETL, no materialized-view pipelines).
- Not multi-database-*engine* at first — **Postgres only**. "Multi-database" here means many *Postgres* databases, not MySQL/SQLite. Abstract the introspection + federation layer so other engines can come later, but do not build for them yet. *(Lifted in **Phase 9** — MySQL then MongoDB behind a driver abstraction.)*
- No **cross-database writes / distributed transactions** in v1. Writes always target exactly one connection (the service that owns the row). Federation is read-only.

---

## 2. Competitive reality (so scope stays honest)

| Tool | Overlaps with | Where Lizard differs |
|------|---------------|----------------------|
| Directus / NocoDB | schema → CRUD UI | Lizard is AI-first & zero-config; no metadata setup required to start |
| Metabase / Grafana | charts & dashboards | Lizard charts are prompt-driven off live schema, no manual query builder needed |
| Supabase Studio | Postgres UI + AI SQL | Lizard works against *any* existing Postgres, not a hosted platform |
| Retool / Appsmith | internal tools | Lizard needs no app assembly; UI is derived, not built |

Implication for scope: **do not** try to beat Directus on breadth of field types or Retool on app-building. Win on "5 seconds from connection string to a usable AI console."

---

## 3. Recommended tech stack

Chosen for fast "vibecoding," type-safety, and runtime-dynamic schema (the schema is not known at build time, so compile-time ORMs like Drizzle are a poor fit for the query layer).

- **App framework:** Next.js (App Router) + TypeScript — single full-stack app, server actions / route handlers for the API.
- **UI:** Tailwind CSS + shadcn/ui (Radix primitives). TanStack Table for data grids, TanStack Query for client data fetching.
- **DB driver:** `pg` (node-postgres), one pool per connection.
- **Query builder:** **Kysely** — type-safe *and* supports fully dynamic queries at runtime (`sql` template + dynamic references). This is the right choice because table/column identifiers are only known at runtime. Use Kysely's introspection helpers plus custom `pg_catalog` queries.
- **Federation engine (cross-database joins/charts):** **DuckDB** embedded in the Node process (`@duckdb/node-api`), using its `postgres` extension to `ATTACH` multiple Postgres connections **read-only** and query across them in one SQL statement. This keeps federation inside Lizard's process and requires **no DDL on the user's databases** (unlike `postgres_fdw`). DuckDB pushes filters down to each Postgres. See §5.6 for alternatives (`postgres_fdw`, Trino) and dialect caveats.
- **AI:** Claude (Anthropic SDK, `@anthropic-ai/sdk`). Default model: **Claude Sonnet 5** for interactive text-to-SQL/chart specs (fast, cheap enough); allow config to Opus 4.8 for hard cases. Use **tool use / structured outputs** — the model returns a validated JSON object, never raw text you `eval`.
- **Charts:** **ECharts** (via `echarts-for-react`) or **Recharts**. Recommend ECharts for the Grafana-like breadth (time series, bar, pie, heatmap, big-number stat panels). Follow the `dataviz` design guidance when styling.
- **Validation:** Zod for all boundaries (API inputs, AI tool outputs, config).
- **Auth (v1):** Auth.js (NextAuth) with a single admin login, or basic env-based auth. Keep it minimal; RBAC is a later phase.
- **State/config store:** a small Lizard-owned Postgres schema (`_lizard`) *or* a local SQLite/JSON file for metadata overrides, dashboards, and saved queries — so Lizard never has to write DDL to the user's schema. **Prefer a separate metadata store; never mutate the target DB's structure.**

---

## 4. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Next.js UI)                   │
│  Table browser · Record CRUD forms · AI query box · Charts    │
└───────────────▲───────────────────────────▲──────────────────┘
                │ TanStack Query             │
┌───────────────┴───────────────────────────┴──────────────────┐
│                     Next.js server (API layer)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │ Introspect │ │  Data/CRUD │ │  AI (text- │ │  Charts    │  │
│  │  service   │ │  service   │ │  to-SQL)   │ │  service   │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘  │
│        │              │              │              │          │
│  ┌─────▼──────────────▼──────────────▼──────────────▼──────┐  │
│  │           SQL Guard (validate · read-only · limits)      │  │
│  └───────┬─────────────────────┬───────────────────────────┘  │
│          │ single-connection   │ cross-connection             │
│          │ (native)            ▼                               │
│          │            ┌──────────────────┐                     │
│          │            │ Federation engine │                    │
│          │            │ (DuckDB: ATTACH   │                    │
│          │            │  many PG, r/o)    │                     │
│          │            └────────┬─────────┘                     │
└──────────┼─────────────────────┼──────────────────────────────┘
           │            ┌────────┴────────┐
           ▼            ▼                 ▼            ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────────────┐
   │  Service DB  │ │  Service DB  │ │  Service DB  │ │ Lizard metadata    │
   │  A (orders)  │ │  B (users)   │ │  C (billing) │ │ store (overrides,  │
   │  r/o + write │ │  r/o + write │ │  r/o + write │ │ dashboards, audit) │
   └─────────────┘ └─────────────┘ └─────────────┘ └────────────────────┘
```

**Key principles:**
- Every query to any target DB — CRUD, AI, or charts — passes through a single **SQL Guard**. Nothing bypasses it.
- **Single-connection reads/writes** run natively on that connection's pool. **Cross-connection reads** are routed to the **federation engine** (DuckDB), which is always read-only.
- A **connection** = one microservice's Postgres database. The UI lets the user pick "which connection(s)" a view, query, or chart spans.

---

## 5. Core subsystems (design detail)

### 5.1 Introspection service
Builds a normalized in-memory **catalog** across **all registered connections** and **all their schemas** from `information_schema` + `pg_catalog`. Cache per connection; refresh on demand and on a TTL. The catalog is a three-level namespace: **connection → schema → table**. Every table reference the rest of the system uses is fully qualified as `connection.schema.table` so nothing is ambiguous across a fleet.

Multi-connection / multi-schema specifics:
- Enumerate all non-system schemas per connection (`information_schema`, `pg_catalog`, `pg_toast` excluded by default; allowlist configurable).
- Track FKs *within* a schema and *across schemas of the same connection* (native joinable). **Cross-connection relationships do not exist in the DB** — Lizard lets users declare **virtual foreign keys** (stored in the metadata store) to link, e.g., `orders.customer_id → users.customer.id`, which power cross-database reference pickers and inform the AI.
- Detect name collisions across connections and always disambiguate in the UI by connection label.

Capture per table:
- Columns: name, data type, nullable, default, is-generated, ordinal position.
- Primary key(s).
- Foreign keys: referencing column → referenced table/column (this drives relation UI).
- Unique constraints & check constraints.
- Enums (`pg_enum`) and columns using them.
- Comments (`pg_description`) — use as human labels/help text.
- Row estimate (`pg_class.reltuples`) — to decide pagination strategy.
- Views vs tables (views are read-only).

Derive **UI heuristics** from this model:
- Display column guess: first `text`/`varchar` non-PK column, or a column named `name`/`title`/`label`/`email`.
- FK columns → render as a searchable reference picker showing the referenced row's display column.
- Enum / check-constraint-with-IN → render as a select.
- `boolean` → toggle; `date/timestamp` → date picker; `json/jsonb` → code editor; `text` > N chars → textarea.
- Hide/readonly: generated columns, `created_at`/`updated_at` patterns become readonly.

### 5.2 Metadata / override layer
Raw heuristics are ~80% right; users need to correct the rest **without config being mandatory**. Store overrides in the Lizard metadata store, keyed by `connection`/`schema`/`table`/`column`:
- rename label, hide column, change widget, reorder fields, set which column is the "display" column, group columns into sections, mark a table hidden.
- **Virtual foreign keys** across connections/schemas (see §5.1) so microservice boundaries can be stitched into relations and cross-DB joins.
- These are *additive* — Lizard works with zero overrides; overrides only refine.

### 5.3 Data / CRUD service
- **List:** paginated (keyset pagination on PK for big tables; offset for small), filterable, sortable, with column selection. All identifiers passed through Kysely dynamic refs (never string-concatenated).
- **Read:** single record + related records (one level of FK expansion), including **cross-connection related records via virtual FKs** (fetched with a secondary query to the other connection, then merged — no join needed for a single record).
- **Create / Update / Delete:** built from schema + overrides; validate against constraints client- and server-side (Zod schemas generated from the schema model). **Writes always target exactly one connection** (the owning service) and go through that connection's **write DB role** in a transaction. No cross-connection/distributed writes in v1. Respect NOT NULL, types, FKs; surface DB constraint errors as friendly messages.
- **Optimistic concurrency:** use an `updated_at` or xmin check where available to avoid lost updates.

### 5.4 AI text-to-SQL service — **the security-critical path**
Flow:
1. User types a natural-language question, optionally scoped to specific connections (default: all registered connections the user may read).
2. Server sends Claude: the **compact multi-connection catalog** (fully-qualified `connection.schema.table`, columns, types, FKs, enums, and declared virtual FKs — token-budgeted; for large fleets, retrieve the relevant subset via embeddings/keyword match) + the question + strict instructions, **including whether the answer needs one connection or several**.
3. Claude returns a **structured tool-use response**: `{ target: "single" | "federated", connections: [...], sql: string, dialect: "postgres" | "duckdb", explanation, params }` — SELECT only.
4. **Router picks the executor:** `single` → that connection's read-only pool (native Postgres). `federated` → the **federation engine** (DuckDB, §5.6) which `ATTACH`es the named connections and runs DuckDB-dialect SQL.
5. **SQL Guard validates** (see §6) against the chosen dialect — parse, assert single statement, assert read-only, inject `LIMIT`, enforce timeout, run on the **read-only role / read-only attachments**.
6. Execute, return rows + the SQL + explanation + which connections it touched (always show the user the SQL and the databases involved — transparency and trust).
7. Offer "turn this into a chart" and "save this query."

Design rules:
- Never execute model SQL without the guard. Never let the model's SQL reach a write-capable connection. Federation attachments are always read-only.
- The model must emit **fully-qualified table names** so cross-connection intent is explicit and auditable.
- Always show the generated SQL and the connections touched (configurable: auto-run reads, but require confirm for anything the guard flags or anything spanning > N connections).
- Keep a conversation-scoped context so follow-ups ("now group by month") work.

### 5.5 Charts service (Grafana-inspired)
Two entry points:
1. **One-click:** from any query result grid, a "Visualize" button. Lizard inspects result columns (types, cardinality) and suggests chart types (time series if a timestamp + numeric; bar if categorical + numeric; single-stat if 1×1; etc.). User picks; renders with ECharts.
2. **Prompt-driven:** "chart revenue by month for 2025." Claude returns a **chart spec** (structured JSON: `{ target, connections, sql, dialect, chartType, xField, yField, series, agg }`), routed/guarded/executed exactly like text-to-SQL (§5.4), then rendered.
3. **Cross-database charts:** because the chart spec carries `target: "federated"` and a connection list, a single panel can join `orders` (service A) with `customers` (service B) and plot the result. This is the microservices headline feature — a chart that spans services with one prompt.

Dashboards: save chart specs as panels; a dashboard is a grid of saved panels, each of which may span different connections, with a shared time range / variables. Store in metadata store. Auto-refresh interval optional. Keep the chart spec **declarative and serializable** (including its connection set) so it survives reloads and can be edited by hand or by AI.

### 5.6 Cross-database reads (the microservices enabler)
**The one constraint worth knowing up front:** Postgres can join across *schemas* on the same connection natively, but it **cannot** join across *separate databases*. So spanning microservice databases needs a small read-only **federation layer** that Lizard owns (an embedded engine that reads from each database and joins the results). Pick the specific engine at build time — the recommendation is DuckDB with its Postgres reader because it needs no changes to the user's databases, but that's an implementation detail.

What it enables as **features**:
- Query and chart across multiple service databases in one go.
- Always read-only — writes never cross a database boundary.
- Lizard shows which databases a query touched, for transparency.
- Guardrails so a cross-database query can't scan everything (row caps, a required limit, optional cached results for dashboards).

---

## 6. Security model (do not skip — this is make-or-break)

The moment you let an LLM generate SQL against a live database, you own a serious attack surface. Requirements:

1. **Two DB roles per connection, least privilege.** Every registered connection provides two credentials:
   - `lizard_read`: `SELECT` only, on allowlisted schemas. Used for AI, charts, list/read, **and as the credential DuckDB attaches with for federation** (federation is read-only by construction).
   - `lizard_write`: scoped `INSERT/UPDATE/DELETE` for CRUD, used *only* by the CRUD service with parameterized queries, never by AI, never by federation.
   - Document the exact `GRANT`/`REVOKE` SQL in the README so users provision it per service DB. A connection may register with only a read role (read-only mode).
2. **SQL Guard** (every target-DB and federated query passes through it), **dialect-aware** (Postgres and DuckDB):
   - Parse SQL (`pgsql-parser` / libpg_query for Postgres; DuckDB parser/`EXPLAIN` for the DuckDB path) — reject anything that isn't a single `SELECT` for the AI/chart/federation paths.
   - Reject multiple statements, DDL, DML, `COPY`, `pg_sleep`, `pg_read_file`, `dblink`, `\!`, comments-based injection. On the DuckDB path additionally reject `ATTACH`/`INSTALL`/`LOAD`/file-system and `read_*`/`COPY` functions from model SQL — Lizard controls attachments, the model never issues them.
   - Enforce a hard `LIMIT` (e.g. 1000) if none present; enforce per-connection row caps before a federated join.
   - Set `statement_timeout` (e.g. 10s) and `idle_in_transaction_session_timeout` on Postgres connections; set the equivalent timeout on DuckDB.
   - Run AI SQL in a **read-only transaction** (`SET TRANSACTION READ ONLY`) as belt-and-suspenders; DuckDB attachments are `READ_ONLY`.
3. **Never string-concatenate identifiers** in the CRUD path — Kysely dynamic refs / parameterized values only.
4. **Prompt-injection awareness:** treat model output as untrusted data, validated by the guard — the guard, not the prompt, is the security boundary.
5. **Resource limits:** connection pool caps, per-request row/byte caps, query cost guard (optionally `EXPLAIN` and reject high-cost plans).
6. **Audit log** (metadata store): who ran what SQL, when, row counts. Essential for trust and debugging.
7. **Secrets:** connection strings and the Anthropic API key from env/secure store, never in the client bundle. All DB and AI calls are server-side only.
8. **RLS-friendly:** if the target DB uses Row-Level Security, run under a role that respects it; expose a "connect as" concept later for per-user data scoping.
9. **Per-connection access control:** which users may read/write which connections is enforced server-side; a federated query is only allowed to attach connections the actor may read, and the guard rejects specs naming connections outside that set.

---

## 7. Data model — Lizard metadata store

Separate Postgres schema `_lizard` (or SQLite file for single-user). Tables:

- `connections` — id, name/label, host/db, read secret ref, write secret ref (nullable → read-only), allowlisted schemas, created_at.
- `virtual_fks` — id, from_connection, from_schema, from_table, from_column, to_connection, to_schema, to_table, to_column, label. (Stitches microservice boundaries; powers cross-DB reference pickers and informs the AI.)
- `table_overrides` — connection_id, schema, table, hidden, display_column, label, section_config (json).
- `column_overrides` — connection_id, schema, table, column, label, widget, hidden, readonly, order, help.
- `saved_queries` — id, name, nl_prompt, target (single/federated), connections (json array), sql, dialect, created_by, created_at.
- `dashboards` — id, name, layout (json).
- `panels` — id, dashboard_id, chart_spec (json, includes target + connections), position.
- `audit_log` — id, actor, action, sql, row_count, duration_ms, created_at.
- `users` / `roles` (later phase).

**Never write to the target database's schema.** All Lizard state lives here.

---

## 8. Phased implementation plan

Each phase ends in a runnable, demoable state. Acceptance criteria are concrete — treat them as the definition of done.

### Phase 0 — Skeleton + connections (foundation)
- App scaffold + Lizard's own metadata store.
- **Connections manager:** add/remove multiple Postgres connections, each with its own credentials and allowed schemas. This is the entry point to everything.
- **Done when:** a user can register two or more Postgres databases and see each connect successfully.

### Phase 1 — Browse everything (read-only)
- Auto-generated, browsable view of every connection → schema → table.
- Paginated, sortable, filterable data grids.
- Foreign-key columns show the referenced row's readable label, not raw ids.
- **Done when:** several databases appear as one browsable tree with usable, readable tables — zero config.

### Phase 2 — Edit data (CRUD)
- Auto-generated create/edit forms with the right widget per column (dropdowns for foreign keys and enums, toggles, date pickers, etc.).
- Validation before save; friendly constraint errors.
- Writes always go to the one database that owns the row (safe write credentials, no cross-database writes). Read-only tables/views are respected.
- **Done when:** full create/edit/delete works on real tables including relations, with validation.

### Phase 3 — Polish the auto UI (overrides)
- Rename labels, hide columns, pick the display column, change a field's widget, reorder fields.
- **Virtual relationships:** let users link a column in one service DB to a record in another (since microservice DBs have no real foreign keys between them) — this powers cross-database reference pickers.
- Overrides only refine; the UI still works with none set.
- **Done when:** a user can tidy up any table's UI and link records across services, without touching the database.

### Phase 4 — Ask in plain language (the wedge) 🔒
- Type a question, get the answer as a table. The generated query is always shown for transparency.
- Works over one database *or across several at once*.
- Read-only and sandboxed — it can never write, drop, or run destructive queries (backed by an adversarial test suite).
- Save useful questions to reuse.
- **Done when:** "top 10 customers by orders last month" returns correct rows across the relevant databases, the query is visible, and the guard provably blocks anything harmful.

### Phase 5 — One-click & prompt charts
- "Visualize" button on any result → smart chart-type suggestion.
- Or describe the chart in words and get it.
- **Cross-database charts:** a single chart can combine data from multiple services.
- Common panel types: big-number stat, time series, bar, pie, table. (Follow the `dataviz` guidance for styling.)
- **Done when:** any result becomes a chart in one click, and "chart revenue by month" works — including across databases.

### Phase 6 — Dashboards
- Arrange saved charts into a grid; shared time range / filters; optional auto-refresh; shareable link.
- Panels may each pull from different databases.
- **Done when:** a user assembles a multi-panel, multi-database dashboard and it reloads intact.

### Phase 7 — Hardening & polish (pre-1.0)
- Login + basic roles (viewer/editor/admin), and per-connection access control.
- Rate limiting and clearer error surfaces.
- Docs: quickstart, the credential-setup recipe, security overview.
- One-command self-host (`docker compose up` with a demo database).
- **Done when:** someone can spin it up, connect their databases, and safely use every feature.

### Status (as built)

Phases 0–7 are implemented: multi-connection catalog introspection; browse (grid with
server-side sort/filter/search, keyset-friendly pagination, column resize, per-user
column visibility); CRUD with schema-derived widgets + reference pickers; the override
layer (labels, widgets, hidden/readonly, display column, sort order) with **multi-tenant
schema-pattern overrides** (`org_*`); **virtual FKs** (composite, value transforms,
constant predicates, `$schema` templating for tenant-local joins, cross-connection);
a dedicated per-table **customize page**; AI text-to-SQL + text-to-chart (single &
federated via DuckDB); charts + dashboards; auth (viewer/editor/admin) + per-connection
grants; audit log. UI is on shadcn (Base UI) with a next-themes light/dark system.

### Phase 8 — Rich data console (no AI, no DBA tooling) 🎯

**Scope guardrail (explicit):** this phase makes the *auto-generated data console* deeper
— the Airtable/NocoDB experience, still zero-config and schema-derived. It is **not** a
SQL/DBA client: no index/vacuum/activity/EXPLAIN tooling, no functions/triggers browser,
no DDL against the target DB. And it is **not** AI — these are deterministic, schema-driven
features. Everything still obeys §6 (reads via `lizard_read`, writes via `lizard_write`
to exactly one connection, never DDL on the target; all new console state lives in the
Lizard metadata store).

**8.1 Rich type widgets** — extend the widget set beyond `text/number/toggle/date/
datetime/select/json/reference/readonly`, derived purely from `udtName`:
- **arrays** (`_int4`, `text[]`, …) → tag/chip editor; grid shows chips
- **ranges** (`int4range`, `tstzrange`, `daterange`) → two-ended editor
- **jsonb** → structured tree editor (already have a read-only `JsonView`; add editing) instead of a raw textarea
- **bytea** → upload / download / image thumbnail
- **network** (`inet`, `cidr`, `macaddr`) → validated inputs
- **interval**, **uuid** (+ generate button), **money/numeric(p,s)** (precision-aware)
- **enum / check-IN multi** (array-of-enum) → multi-select
- Extension-gated widgets light up only when the extension is present (`pg_extension`):
  **PostGIS** `geometry/geography` → map cell (Leaflet); **pgvector** `vector` → shown as a
  compact dimension summary (similarity *search* stays out of scope here — it edges toward AI).

**8.2 Editing productivity:**
- **Inline cell editing** in the grid (not only the drawer)
- **Bulk edit** (select rows → set one field) and **bulk delete** (row-selection checkboxes)
- **Duplicate row**
- **Inline check-constraint validation** — we already capture `checkConstraints`; validate
  client-side *before* the round-trip, surface friendly errors

**8.3 Saved views** (metadata store) — a named bundle of `{ filter, sort, visibleColumns,
viewType, groupBy }` per table, shareable, with a default. Purely Lizard-side; no target writes.

**8.4 View types** — alternate renderings of the same rows, auto-offered from the schema:
- **Table** (today)
- **Kanban** — group by any enum / check-IN / low-cardinality FK column; drag between
  columns = an `UPDATE` of that one field via the existing single-connection write path
- **Gallery / cards** — for tables with an image column or a display column
- **Calendar** — for tables with a `date`/`timestamp` column
- **Tree** — self-referencing FK (`parent_id`) → expandable hierarchy (recursive CTE)

**8.5 Relationships:**
- **M2M linked-records** — auto-detect a two-FK junction table and render it as a
  multi-select on both parent records (add/remove = insert/delete junction rows, one connection)
- Keep existing reverse-FK "has-many" cards on the record page

**8.6 Richer filters** — add operators on top of the existing `FilterSet`/combinator:
regex (`~*`), array contains/overlap (`@>`/`&&`), range overlap, `BETWEEN`, `IN (list)`,
`IS DISTINCT FROM`, jsonb containment (`@>`) / path (`->>`).

**8.7 Data movement:**
- **CSV / Excel export** honoring the current filter/sort/selection
- **CSV import** with column mapping, validated against types/constraints; `COPY`-backed for speed
  (still through `lizard_write`, one connection, in a transaction)

**8.8 Refresh (not LISTEN/NOTIFY):** real Postgres LISTEN/NOTIFY needs a trigger
calling `pg_notify(...)` on the target table — i.e. Lizard would have to write DDL
to someone's database, which directly contradicts §7 ("never write to the target
database's schema"). Decided against it. Instead, a Grafana-style **auto-refresh
interval** per view (off / 5s / 10s / 30s / 1m, **default off**) that just calls
the existing refetch on a timer — zero target-DB changes, works across every view
type (table/kanban/gallery/calendar), and is saved as part of a saved view.

**8.9 Metadata-only extras (zero target-DB access):**
- **Per-record comments / annotations** — Airtable-style, stored Lizard-side, works on any table
- **Record history** — surfaced from the existing audit path (who changed which row, when)

**Done when:** a user can pick a view type per table, edit inline and in bulk, use rich
widgets for every common Postgres type, save named views, import/export CSV, watch a live
grid, and comment on records — all with zero config and no DDL on their database.

### Phase 9 — Multi-engine support (MySQL, then MongoDB) 🧩

Until now "multi-database" meant many *Postgres* databases (§1 non-goals). Phase 9
lifts that: Lizard becomes multi-*engine*. This is two projects of very different
shape — do not conflate them.

- **MySQL is a driver-abstraction effort.** The relational model still holds; it is
  broad but mechanical. Every SQL fragment differs (backtick idents, `?` params,
  `LIKE`/`REGEXP`, no arrays, no `RETURNING`, `CAST()` not `::`, different
  `information_schema`, inline enums, different error codes) but the *shape* of
  introspect/list/CRUD/filter is shared with Postgres.
- **MongoDB is a second query paradigm.** No SQL, no schema, no fixed columns. The
  catalog must be inferred by sampling documents; the guard, executor, filters, and
  the entire text-to-SQL AI path stop being SQL. Federation with Mongo is weak
  (DuckDB has no first-class Mongo attach). Several Phase-8 features are partial.

**Locked decisions (drive the code):**
1. **One backend home.** All backend/domain code lives under `app/api/` (Next.js
   colocation — non-route modules under `app/api/` are never routed). No second
   top-level `api/` dir. `lib/` shrinks to a shared kernel (types, utils, zod,
   auth). Route handlers (`app/api/**/route.ts`) become thin HTTP adapters.
2. **Domain-primary, driver as a strategy axis.** The new home is
   `app/api/database/`: a `Dialect`/`Driver` interface (`driver.ts`), a shared
   relational base (`sql/`) that Postgres + MySQL extend via dialect hooks, and
   per-engine implementations under `dialect/` / `drivers/`. Mongo is a fully
   separate implementation, not an extension of the relational base. Cross-driver
   domains (guard, ai, federation, introspect, crud) call through the interface,
   never a driver folder directly.
3. **Schema stays internal & always-present.** The `connection → schema → table`
   namespace is preserved everywhere in the data model. Non-Postgres engines report
   a **synthetic schema** (MySQL: the database name; Mongo: `default`) so
   introspection/CRUD/AI stay uniform.
4. **Schema is optional sugar in the browse URL only.** `/browse/<connection>/<table>?schema=public`
   — the browse UI resolves an omitted schema (single-schema connection → that one;
   Postgres → `public`; otherwise 404 asking to disambiguate) and calls the API with
   the resolved schema. **The API path stays fully qualified** (`/api/data/[connection]/[schema]/[table]`) —
   sugar at the edge, precision in the core.
5. **MySQL connection = one database** (schema omitted in the UI). A MySQL server
   with several databases registers as several connections; an intra-server
   cross-database join therefore routes through federation. Accepted trade for a
   simpler URL/mental model.
6. **`engine` on every connection** (`postgres | mysql | mongo`, default `postgres`).
   Existing connections migrate to `postgres` transparently.

**Phasing (build in order, keep the build green at each step):**
- **9A — Extract the driver interface (no behavior change).** Add `engine` to the
  connection model. Stand up `app/api/database/` with the `Dialect`/`Driver`
  interface and the **Postgres** implementation that mirrors today's behavior. Move
  `lib/{db,introspect,guard,federation,ai,data,metadata}` into `app/api/` behind the
  interface incrementally (mechanical import churn; guard with the adversarial suite).
- **9B — MySQL, single-connection.** MySQL dialect + driver (introspect via its
  `information_schema`, backtick/`?`/`CAST`/`LIKE`/error-map, type→widget). Browse,
  CRUD, filters, single-DB AI. Ship without federation.
- **9C — MySQL federation.** DuckDB `mysql` extension → cross-engine PG↔MySQL
  joins/charts through the existing federation path.
- **9D — MongoDB, browse + CRUD only.** Sampling-based introspection, document grid,
  single-doc CRUD, a Mongo query language + its own read-only guard (block
  `$out`/`$merge`/`$function`/`$where`/cross-db `$lookup`). Federation and
  prompt-to-chart-across-Mongo are **out of scope** for Mongo v1.
- **9E — (stretch) Mongo in AI/federation**, to whatever degree DuckDB's Mongo
  story allows.

### Later / stretch
- SQLite behind the same driver abstraction (relational, easiest engine after MySQL).
- Embeddings-based schema retrieval for very large schemas.
- Saved AI "workflows," scheduled reports.
- Plugin system for custom widgets/panels.
- (Deliberately *out*: DBA/SQL-client tooling — indexes/vacuum/activity/EXPLAIN,
  function & trigger browsers, DDL on the target DB. Kept out to stay a data *console*.)

---

## 9. Repository structure (suggested)

All backend/domain code lives under `app/api/` (one backend home — Next.js
colocation means non-route `.ts` modules there are never routed). `lib/` is a
shared kernel only. Route handlers (`app/api/**/route.ts`) are thin HTTP adapters.

```
lizard/
├─ app/                    # Next.js App Router
│  ├─ browse/              # table browser + CRUD UI  (/browse/<conn>/<table>?schema=)
│  ├─ ai/                  # AI query console
│  ├─ dashboards/          # charts & dashboards
│  └─ api/                 # ── the backend home ──
│     ├─ **/route.ts       #    thin HTTP adapters (parse req → call domain → shape resp)
│     └─ database/         #    engine layer
│        ├─ driver.ts      #      Dialect + Driver interfaces (the seam)
│        ├─ registry.ts    #      engine → driver/dialect resolver
│        ├─ dialect/       #      postgres.ts, mysql.ts (relational SQL primitives)
│        ├─ sql/           #      shared relational introspect/list/CRUD (PG + MySQL)
│        └─ drivers/       #      mongo.ts (document store — separate builder)
├─ lib/                    # shared kernel: types, utils, zod, auth  (no engine logic)
├─ components/             # shadcn/ui + shared UI
├─ migrations/             # _lizard (SQLite) metadata-store migrations
├─ tests/
│  └─ guard/               # adversarial SQL-injection / prompt-injection suite
└─ docker-compose.yml
```

> During Phase 9A the current `lib/{db,introspect,guard,federation,ai,data,metadata}`
> modules migrate under `app/api/` incrementally; until a module has moved, treat its
> `lib/` location as the temporary home. New engine code is born under `app/api/database/`.

---

## 10. Success criteria for v1.0

1. **Zero-config start:** connection string → working browsable, editable UI in under a minute.
2. **AI that's trustworthy:** NL → correct SQL, always visible, provably sandboxed (adversarial test suite green).
3. **Charts without a query builder:** click-to-visualize and prompt-to-chart both work.
4. **Safe by construction:** two-role model + SQL Guard + audit log; no path lets AI write to the DB.
5. **Self-hostable in one command.**

---

*End of plan. Build phases in order; keep every phase demoable; never let the AI write to a database.*
