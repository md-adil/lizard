// End-to-end core test against the docker-compose demo fleet.
// Requires: `docker compose up -d` (users-db on 54321, orders-db on 54322).
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LIZARD_METADATA_PATH = join(mkdtempSync(join(tmpdir(), "lizard-test-")), "meta.sqlite");

const { addConnection, addVirtualFk } = await import("@/lib/metadata/store");
const { getCatalog } = await import("@/lib/introspect/catalog");
const { listRows, createRow, updateRow, deleteRow, getRow } = await import("@/lib/data/crud");
const { runGuardedQuery } = await import("@/lib/execute");

beforeAll(() => {
  addConnection({
    name: "users_service",
    engine: "postgres",
    host: "localhost",
    port: 54321,
    database: "users_service",
    readUser: "lizard_read",
    readPassword: "lizard_read",
    writeUser: "lizard_write",
    writePassword: "lizard_write",
    ssl: false,
    allowedSchemas: null,
  });
  addConnection({
    name: "orders_service",
    engine: "postgres",
    host: "localhost",
    port: 54322,
    database: "orders_service",
    readUser: "lizard_read",
    readPassword: "lizard_read",
    writeUser: "lizard_write",
    writePassword: "lizard_write",
    ssl: false,
    allowedSchemas: null,
  });
  addVirtualFk({
    fromConnection: "orders_service",
    fromSchema: "public",
    fromTable: "orders",
    toConnection: "users_service",
    toSchema: "public",
    toTable: "customers",
    pairs: [{ from: "customer_id", to: "id", transform: "none" }],
    constants: [],
    label: "customer",
    joinHint: null,
  });
});

describe("introspection", () => {
  it("builds a catalog across both connections and all schemas", async () => {
    const catalog = await getCatalog(true);
    expect(catalog.connections).toHaveLength(2);
    const users = catalog.connections.find((c) => c.connectionName === "users_service")!;
    expect(users.error).toBeUndefined();
    expect(users.schemas.map((s) => s.name).sort()).toEqual(["crm", "public"]);
    const customers = users.schemas.find((s) => s.name === "public")!.tables.find((t) => t.name === "customers")!;
    expect(customers.primaryKey).toEqual(["id"]);
    expect(customers.comment).toContain("signed up");
    const email = customers.columns.find((c) => c.name === "email")!;
    expect(email.nullable).toBe(false);

    const leads = users.schemas.find((s) => s.name === "crm")!.tables.find((t) => t.name === "leads")!;
    expect(leads.foreignKeys[0].referencedTable).toBe("customers");
    const source = leads.columns.find((c) => c.name === "source")!;
    expect(source.enumValues).toContain("referral");
    const statusCheck = leads.checkConstraints.find((c) => c.inColumn === "status");
    expect(statusCheck?.inValues).toContain("qualified");
  });
});

describe("CRUD", () => {
  it("lists with filters, sort, pagination and FK labels", async () => {
    const res = await listRows({
      connection: "orders_service",
      schema: "public",
      table: "order_items",
      page: 0,
      pageSize: 10,
      sort: "id",
      sortDir: "asc",
    });
    expect(res.rows.length).toBe(10);
    expect(res.hasMore).toBe(true);
    // product_id FK labels resolved to product names
    expect(Object.keys(res.fkLabels)).toContain("product_id");

    const filtered = await listRows({
      connection: "users_service",
      schema: "public",
      table: "customers",
      page: 0,
      pageSize: 50,
      filters: [{ column: "country", op: "eq", value: "DE" }],
    });
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((r) => r.country === "DE")).toBe(true);
  });

  it("resolves cross-connection labels via virtual FKs", async () => {
    const res = await listRows({
      connection: "orders_service",
      schema: "public",
      table: "orders",
      page: 0,
      pageSize: 5,
    });
    expect(Object.keys(res.fkLabels)).toContain("customer_id");
    const labels = res.fkLabels.customer_id;
    expect(Object.keys(labels).length).toBeGreaterThan(0);
  });

  it("create → read → update → delete round-trip with validation", async () => {
    const created = await createRow("users_service", "public", "customers", {
      name: "Test Person",
      email: `lizard-test-${Date.now()}@example.com`,
      country: "NZ",
    });
    expect(created.id).toBeDefined();

    const { row } = await getRow("users_service", "public", "customers", { id: created.id });
    expect(row.name).toBe("Test Person");

    const updated = await updateRow("users_service", "public", "customers", { id: created.id }, { country: "AU" });
    expect(updated.country).toBe("AU");

    const del = await deleteRow("users_service", "public", "customers", { id: created.id });
    expect(del.deleted).toBe(1);
  });

  it("surfaces constraint violations as friendly errors", async () => {
    await expect(createRow("users_service", "public", "customers", { name: "No Email" })).rejects.toThrow(/required/i);
    await expect(createRow("users_service", "crm", "leads", { status: "bogus" })).rejects.toThrow(
      /check constraint|invalid/i,
    );
  });
});

describe("guarded query execution", () => {
  it("runs a single-connection query read-only with row cap", async () => {
    const res = await runGuardedQuery({
      target: "single",
      connections: ["users_service"],
      sql: "SELECT country, count(*) AS n FROM customers GROUP BY 1 ORDER BY n DESC",
      dialect: "postgres",
    });
    expect(res.rows.length).toBeGreaterThan(3);
    expect(res.connections).toEqual(["users_service"]);
  });

  it("blocks writes even if they somehow reach execution", async () => {
    await expect(
      runGuardedQuery({
        target: "single",
        connections: ["users_service"],
        sql: "DELETE FROM customers",
        dialect: "postgres",
      }),
    ).rejects.toThrow(/Forbidden|Only SELECT/);
  });

  it("federates a cross-database join through DuckDB", async () => {
    const res = await runGuardedQuery({
      target: "federated",
      connections: ["users_service", "orders_service"],
      sql: `SELECT c.country, count(o.id) AS orders, sum(o.total_cents) AS revenue_cents
            FROM users_service.public.customers c
            JOIN orders_service.public.orders o ON o.customer_id = c.id
            GROUP BY c.country ORDER BY revenue_cents DESC`,
      dialect: "duckdb",
    });
    expect(res.rows.length).toBeGreaterThan(3);
    expect(res.connections).toEqual(["users_service", "orders_service"]);
    expect(Number(res.rows[0].revenue_cents)).toBeGreaterThan(0);
  }, 60_000);

  it("rejects unknown connections", async () => {
    await expect(
      runGuardedQuery({ target: "single", connections: ["nope"], sql: "SELECT 1", dialect: "postgres" }),
    ).rejects.toThrow(/Unknown connection/);
  });
});
