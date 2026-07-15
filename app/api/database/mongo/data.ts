// MongoDB data/CRUD service — the document-store counterpart to the relational
// SQL path in app/api/data/crud.ts. It is a *separate* implementation (Phase 9
// decision 2: Mongo is not an extension of the relational base): the shared
// crud.ts dispatches here by engine, and these functions return the exact same
// shapes its route handlers already consume, so browse/CRUD stay uniform.
//
// Safety model: reads use only find/aggregate (never a write op) through the
// read client and carry a maxTimeMS budget; writes go through the write client,
// which requires write credentials. Field names are validated against the
// sampled catalog before use; values are coerced to their BSON type.
import type { ConnectionConfig, FkLabels, TableInfo } from "@/lib/types";
import type { ListParams, GroupedListParams } from "@/app/api/data/crud";
import type { FilterCondition, Combinator } from "@/lib/data/filters";
import { effectiveKey, guessDisplayColumn } from "@/lib/introspect/heuristics";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { getColumnOverrides, listTableOverrides, logAudit } from "@/lib/metadata/store";
import { getMongoDb, READ_MAX_TIME_MS, WRITE_MAX_TIME_MS } from "./client";
import { serializeDoc, coerceId, coerceWriteValue } from "./bson";
import { buildMongoFilter, andFilters } from "./filters";
import { buildMongoSearchFilter } from "./search";
// crud.ts imports this module only via a runtime dynamic import (never at its
// top level), so this static import back into it is fully evaluated by the time
// any function here runs — no load-order cycle — and reusing CrudError means
// lib/api.ts's `fail()` maps our errors to the right HTTP status.
import { CrudError, fetchFkLabels } from "@/app/api/data/crud";

function assertColumn(table: TableInfo, column: string): void {
  if (!table.columns.some((c) => c.name === column)) {
    throw new CrudError(`Unknown column: ${column}`);
  }
}

export function mongoDisplayColumn(conn: ConnectionConfig, table: TableInfo): string | null {
  const override = resolveTableOverride(listTableOverrides(), conn.id, table.schema, table.name);
  if (override?.displayColumn && table.columns.some((c) => c.name === override.displayColumn)) {
    return override.displayColumn;
  }
  return guessDisplayColumn(table);
}

// Columns hidden in the grid, to drop from a list projection (matches
// selectColumnsFor's intent in crud.ts). Keys always kept so editing works.
function gridProjection(conn: ConnectionConfig, table: TableInfo, keep: (string | null)[]): Record<string, 0 | 1> | undefined {
  const overrides = getColumnOverrides(conn.id, table.schema, table.name);
  const prunable = overrides.filter((o) => o.hidden || o.hiddenInGrid).map((o) => o.column);
  if (prunable.length === 0) return undefined;
  const keepSet = new Set(keep.filter((c): c is string => !!c));
  const projection: Record<string, 0 | 1> = {};
  for (const col of prunable) {
    if (!keepSet.has(col)) projection[col] = 0;
  }
  return Object.keys(projection).length > 0 ? projection : undefined;
}

// Sort spec: explicit sort, else newest-first by _id (an ObjectId encodes its
// creation time, so descending _id ≈ most recent first — the same intent as the
// relational path's "last indexed timestamp, desc" default).
function sortSpec(table: TableInfo, sort?: string, sortDir?: "asc" | "desc"): Record<string, 1 | -1> {
  if (sort && table.columns.some((c) => c.name === sort)) {
    return { [sort]: sortDir === "desc" ? -1 : 1 };
  }
  return { _id: -1 };
}

function whereFor(
  conn: ConnectionConfig,
  table: TableInfo,
  filters?: FilterCondition[],
  combinator?: Combinator,
  search?: string,
) {
  const filter = buildMongoFilter(table, filters ?? [], combinator ?? "and");
  const searchFilter = search ? buildMongoSearchFilter(conn, table, search) : null;
  return andFilters(filter, searchFilter);
}

// ---------- list ----------

export async function mongoListRows(conn: ConnectionConfig, table: TableInfo, params: ListParams) {
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const where = whereFor(conn, table, params.filters, params.combinator, params.search);
  const pageSize = Math.min(Math.max(params.pageSize, 1), 200);
  const skip = Math.max(params.page, 0) * pageSize;
  const projection = gridProjection(conn, table, [
    ...effectiveKey(table),
    mongoDisplayColumn(conn, table),
    params.sort ?? null,
  ]);

  const docs = await coll
    .find(where, { projection, maxTimeMS: READ_MAX_TIME_MS })
    .sort(sortSpec(table, params.sort, params.sortDir))
    .skip(skip)
    .limit(pageSize + 1)
    .toArray();

  const hasMore = docs.length > pageSize;
  const rows = (hasMore ? docs.slice(0, pageSize) : docs).map(serializeDoc);

  // Exact count for modest collections; skip for large unfiltered ones.
  let total: number | null = null;
  if (table.rowEstimate < 100_000 || Object.keys(where).length > 0) {
    total = await coll.countDocuments(where, { maxTimeMS: READ_MAX_TIME_MS });
  } else {
    total = table.rowEstimate;
  }

  // A document store has no declared relationships of its own, but a virtual
  // FK can still point from a Mongo column to any other table/connection
  // (relational or Mongo) — resolve those the same way the relational path does.
  const fkLabels = await fetchFkLabels(conn, table, rows);
  return { rows, hasMore, total, fkLabels };
}

export async function mongoListGroupedRows(conn: ConnectionConfig, table: TableInfo, params: GroupedListParams) {
  assertColumn(table, params.groupBy);
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const where = whereFor(conn, table, params.filters, params.combinator, params.search);
  const perGroup = Math.min(Math.max(params.perGroup, 1), 200);
  const maxGroups = Math.min(Math.max(params.maxGroups ?? 50, 1), 200);
  const sort = sortSpec(table, params.sort, params.sortDir);

  // Calendar (day grouping): count per day in one grouped pass (no $push of
  // every document into memory), then fetch each day's top-N via a bounded
  // range query on the date field — the document-store twin of the relational
  // per-day fetch. The calendar only offers indexed date fields, so each
  // range find rides that index.
  if (params.groupKind === "day") {
    const grouped = await coll
      .aggregate(
        [
          { $match: where },
          { $group: { _id: { $dateTrunc: { date: `$${params.groupBy}`, unit: "day" } }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $limit: maxGroups },
        ],
        { maxTimeMS: READ_MAX_TIME_MS, allowDiskUse: true },
      )
      .toArray();
    const days = grouped.filter((g) => g._id instanceof Date) as { _id: Date; count: number }[];
    const groupCounts: Record<string, number> = {};
    for (const g of days) groupCounts[g._id.toISOString()] = g.count;

    const perDay = await Promise.all(
      days.map(async (g) => {
        const start = g._id;
        const end = new Date(start.getTime() + 86_400_000);
        const dayFilter = andFilters(where, { [params.groupBy]: { $gte: start, $lt: end } });
        const docs = await coll.find(dayFilter, { maxTimeMS: READ_MAX_TIME_MS }).sort(sort).limit(perGroup).toArray();
        return docs.map(serializeDoc);
      }),
    );
    return { rows: perDay.flat(), groupCounts, fkLabels: {} as FkLabels };
  }

  // Kanban (value grouping): a small number of low-cardinality groups, so the
  // $push/$slice top-N per group is fine here.
  const rows = await coll
    .aggregate(
      [
        { $match: where },
        { $sort: sort },
        { $group: { _id: `$${params.groupBy}`, docs: { $push: "$$ROOT" }, count: { $sum: 1 } } },
        { $limit: maxGroups },
        { $project: { docs: { $slice: ["$docs", perGroup] }, count: 1 } },
      ],
      { maxTimeMS: READ_MAX_TIME_MS, allowDiskUse: true },
    )
    .toArray();

  const outRows: Record<string, unknown>[] = [];
  const groupCounts: Record<string, number> = {};
  for (const g of rows) {
    const keyVal = g._id;
    const key = keyVal == null ? "" : keyVal instanceof Date ? keyVal.toISOString() : String(keyVal);
    groupCounts[key] = g.count as number;
    for (const doc of g.docs as Record<string, unknown>[]) outRows.push(serializeDoc(doc));
  }

  // Kanban cards resolve FK labels (day grouping returned above), matching
  // listGroupedRows's relational counterpart.
  const fkLabels = await fetchFkLabels(conn, table, outRows);
  return { rows: outRows, groupCounts, fkLabels };
}

const EXPORT_ROW_LIMIT = 100_000;

export async function mongoExportRows(conn: ConnectionConfig, table: TableInfo, params: Omit<ListParams, "page" | "pageSize">) {
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const where = whereFor(conn, table, params.filters, params.combinator, params.search);
  const docs = await coll
    .find(where, { maxTimeMS: READ_MAX_TIME_MS })
    .sort(sortSpec(table, params.sort, params.sortDir))
    .limit(EXPORT_ROW_LIMIT + 1)
    .toArray();
  const truncated = docs.length > EXPORT_ROW_LIMIT;
  const rows = (truncated ? docs.slice(0, EXPORT_ROW_LIMIT) : docs).map(serializeDoc);
  // Union of keys across rows preserves fields absent from some documents.
  const columns = table.columns.map((c) => c.name);
  const seen = new Set(columns);
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), columns.push(k));
  return { columns, rows, truncated };
}

// ---------- single row ----------

// Build a Mongo filter from a validated key object (usually { _id }).
function keyFilter(table: TableInfo, key: Record<string, unknown>): Record<string, unknown> {
  const cols = Object.keys(key);
  if (cols.length === 0) throw new CrudError("No lookup key provided");
  const filter: Record<string, unknown> = {};
  for (const col of cols) {
    assertColumn(table, col);
    filter[col] = col === "_id" ? coerceId(key[col]) : key[col];
  }
  return filter;
}

export async function mongoGetRow(conn: ConnectionConfig, table: TableInfo, key: Record<string, unknown>) {
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const doc = await coll.findOne(keyFilter(table, key), { maxTimeMS: READ_MAX_TIME_MS });
  if (!doc) throw new CrudError("Row not found", 404);
  const row = serializeDoc(doc);
  const fkLabels = await fetchFkLabels(conn, table, [row]);
  return { row, fkLabels };
}

// Distinct existing values of a text-like column, for autocomplete widgets.
export async function mongoColumnSuggestions(
  conn: ConnectionConfig,
  table: TableInfo,
  column: string,
  search: string,
  mode: "contains" | "prefix" = "contains",
): Promise<string[]> {
  assertColumn(table, column);
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  const match: Record<string, unknown> = { [column]: { $ne: null } };
  if (search) {
    const esc = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match[column] = { $ne: null, $regex: mode === "prefix" ? `^${esc}` : esc, $options: "i" };
  }
  const values = await coll.distinct(column, match, { maxTimeMS: READ_MAX_TIME_MS });
  return values
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map((v) => String(v))
    .slice(0, 20);
}

// Tag-widget distinct values: flatten array-valued fields across documents.
export async function mongoDistinctColumnValues(
  conn: ConnectionConfig,
  table: TableInfo,
  column: string,
  search: string,
): Promise<string[]> {
  assertColumn(table, column);
  const db = await getMongoDb(conn, "read");
  const coll = db.collection(table.name);
  // `distinct` already unwinds array-valued fields to their elements.
  const values = await coll.distinct(column, { [column]: { $ne: null } }, { maxTimeMS: READ_MAX_TIME_MS });
  const q = search.toLowerCase();
  const flat = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v) flat.add(v);
    else if (typeof v === "number") flat.add(String(v));
  }
  return [...flat]
    .filter((v) => !q || v.toLowerCase().includes(q))
    .sort()
    .slice(0, 50);
}

// ---------- writes ----------

// Coerce a payload's known columns to their BSON types; unknown fields (a
// schemaless document may carry extras the create form surfaced) pass through.
function coercePayload(table: TableInfo, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const col = table.columns.find((c) => c.name === k);
    out[k] = coerceWriteValue(v, col?.udtName);
  }
  return out;
}

export async function mongoCreateRow(conn: ConnectionConfig, table: TableInfo, data: Record<string, unknown>) {
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const doc = coercePayload(table, data);
  // Let the server assign _id when it's absent or blank.
  if (doc._id == null || doc._id === "") delete doc._id;
  const db = await getMongoDb(conn, "write");
  const coll = db.collection(table.name);
  try {
    const res = await coll.insertOne(doc, { maxTimeMS: WRITE_MAX_TIME_MS });
    logAudit({ action: "create", sql: `insertOne ${table.schema}.${table.name}`, connections: [conn.name], rowCount: 1 });
    const inserted = await coll.findOne({ _id: res.insertedId }, { maxTimeMS: READ_MAX_TIME_MS });
    return inserted ? serializeDoc(inserted) : serializeDoc({ ...doc, _id: res.insertedId });
  } catch (e) {
    throw friendlyError(e);
  }
}

const IMPORT_ROW_LIMIT = 5000;

export async function mongoBulkInsert(
  conn: ConnectionConfig,
  table: TableInfo,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; errors: { row: number; message: string }[] }> {
  if (rows.length === 0) return { inserted: 0, errors: [] };
  if (rows.length > IMPORT_ROW_LIMIT) throw new CrudError(`Import is capped at ${IMPORT_ROW_LIMIT} rows per request`);
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const db = await getMongoDb(conn, "write");
  const coll = db.collection(table.name);
  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  // ordered:false so one bad document doesn't abort the rest.
  const docs = rows.map((r) => {
    const d = coercePayload(table, r);
    if (d._id == null || d._id === "") delete d._id;
    return d;
  });
  try {
    const res = await coll.insertMany(docs, { ordered: false, maxTimeMS: WRITE_MAX_TIME_MS });
    inserted = res.insertedCount;
  } catch (e: unknown) {
    // A BulkWriteError still reports how many succeeded plus per-index errors.
    const err = e as { insertedCount?: number; writeErrors?: { index: number; errmsg?: string }[] };
    inserted = err.insertedCount ?? 0;
    for (const we of err.writeErrors ?? []) errors.push({ row: we.index, message: we.errmsg ?? "insert failed" });
    if (!err.writeErrors) throw friendlyError(e);
  }
  logAudit({ action: "import", sql: `insertMany ${table.schema}.${table.name} (${inserted} rows)`, connections: [conn.name], rowCount: inserted });
  return { inserted, errors };
}

export async function mongoUpdateRow(
  conn: ConnectionConfig,
  table: TableInfo,
  pk: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const filter = keyFilter(table, pk);
  const payload = coercePayload(table, data);
  // Never rewrite _id.
  delete payload._id;
  const db = await getMongoDb(conn, "write");
  const coll = db.collection(table.name);
  try {
    const res = await coll.updateOne(filter, { $set: payload }, { maxTimeMS: WRITE_MAX_TIME_MS });
    if (res.matchedCount === 0) throw new CrudError("Row not found", 404);
    logAudit({ action: "update", sql: `updateOne ${table.schema}.${table.name}`, connections: [conn.name], rowCount: 1 });
    const updated = await coll.findOne(filter, { maxTimeMS: READ_MAX_TIME_MS });
    if (!updated) throw new CrudError("Row not found", 404);
    return serializeDoc(updated);
  } catch (e) {
    if (e instanceof CrudError) throw e;
    throw friendlyError(e);
  }
}

export async function mongoDeleteRow(conn: ConnectionConfig, table: TableInfo, pk: Record<string, unknown>) {
  if (table.kind === "view") throw new CrudError("Views are read-only", 405);
  const filter = keyFilter(table, pk);
  const db = await getMongoDb(conn, "write");
  const coll = db.collection(table.name);
  try {
    const res = await coll.deleteOne(filter, { maxTimeMS: WRITE_MAX_TIME_MS });
    if (res.deletedCount === 0) throw new CrudError("Row not found", 404);
    logAudit({ action: "delete", sql: `deleteOne ${table.schema}.${table.name}`, connections: [conn.name], rowCount: res.deletedCount });
    return { deleted: res.deletedCount };
  } catch (e) {
    if (e instanceof CrudError) throw e;
    throw friendlyError(e);
  }
}

// Map common MongoDB write errors to friendly messages.
function friendlyError(e: unknown): CrudError {
  if (e instanceof CrudError) return e;
  const err = e as { code?: number; message?: string };
  if (err.code === 11000) return new CrudError("A record with these values already exists (duplicate key)", 409);
  return new CrudError(err.message ?? String(e), 400);
}
