// FK/virtual-FK label resolution against a Mongo target. The relational
// counterpart (app/api/data/crud.ts's inline SQL branch in fetchFkLabels)
// builds a single `key IN (...)` query via a Dialect; Mongo has no dialect or
// pooled client, so this does the same job with a driver-level find(). Both
// paths return the identical contract fetchFkLabels expects: a Map from
// String(...)-per-pair-column-joined-by-SEP to the resolved display label —
// so a lookup resolves the same way regardless of which side of the relation
// (or neither) is Mongo.
import type { ConnectionConfig, TableInfo } from "@/lib/types";
import { getMongoDb, READ_MAX_TIME_MS } from "./client";
import { coerceId, serializeValue } from "./bson";

export async function mongoFkLookup(
  targetConn: ConnectionConfig,
  table: string,
  targetTable: TableInfo,
  pairs: { from: string; to: string }[],
  tuples: unknown[][],
  targetConstants: { toColumn: string; side?: "source" | "target"; value: string }[],
  display: string,
  keySep: string,
): Promise<Map<string, string>> {
  // A cross-engine join carries key values as plain strings/numbers (see
  // serializeDoc). An ObjectId-typed target column needs those coerced back
  // before they'll match a stored ObjectId — same rule as keyFilter/
  // coercePayload in data.ts.
  const coerceForCol = (col: string, v: unknown) =>
    targetTable.columns.find((c) => c.name === col)?.udtName === "objectid" ? coerceId(v) : v;

  const orClauses = tuples.map((tuple) => {
    if (pairs.length === 1) return { [pairs[0].to]: coerceForCol(pairs[0].to, tuple[0]) };
    const and: Record<string, unknown> = {};
    pairs.forEach((p, i) => (and[p.to] = coerceForCol(p.to, tuple[i])));
    return and;
  });
  if (orClauses.length === 0) return new Map();

  const baseFilter = orClauses.length === 1 ? orClauses[0] : { $or: orClauses };
  const constFilter: Record<string, unknown> = {};
  for (const c of targetConstants) constFilter[c.toColumn] = c.value;
  const filter = targetConstants.length > 0 ? { $and: [baseFilter, constFilter] } : baseFilter;

  const db = await getMongoDb(targetConn, "read");
  const coll = db.collection(table);
  const projection: Record<string, 1> = { [display]: 1 };
  for (const p of pairs) projection[p.to] = 1;

  const docs = await coll
    .find(filter, { projection, maxTimeMS: READ_MAX_TIME_MS })
    .limit(tuples.length + 50)
    .toArray();

  const keyToLabel = new Map<string, string>();
  for (const doc of docs) {
    const label = doc[display];
    if (label == null) continue;
    const key = pairs.map((p) => String(doc[p.to])).join(keySep);
    keyToLabel.set(key, String(serializeValue(label)));
  }
  return keyToLabel;
}
