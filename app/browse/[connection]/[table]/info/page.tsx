"use client";

// Read-only reference page for one table — columns/keys, foreign-key lists,
// and its relationship graph. Separate from customize/ (which edits
// overrides/virtual FKs): this page only ever reads, and is reached from the
// browse grid's "Info" button, not from any settings flow.
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTableMeta } from "@/components/browse/useTableMeta";
import { useSchemaParam, tableHref, customizeHref, infoHref } from "@/components/browse/use-schema-param";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ForeignKeyLists } from "@/components/browse/fk-lists";
import { RelationshipDiagram } from "@/components/browse/relationship-diagram";
import { buildNeighborGraph, type GraphNode } from "@/lib/relationship-graph";

type InfoTab = "columns" | "constraints" | "relationships" | "graph";

export default function TableInfoPage() {
  const params = useParams<{ connection: string; table: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const schema = useSchemaParam();
  const { meta, catalog, schemaMeta, isLoading } = useTableMeta(params.connection, schema, params.table);

  const tab = (searchParams.get("tab") as InfoTab | null) ?? "columns";
  const backHref = tableHref({ connection: params.connection, schema: meta?.schema ?? schema, table: params.table });

  function setTab(next: InfoTab) {
    const q = new URLSearchParams(searchParams);
    q.set("tab", next);
    router.replace(`?${q.toString()}`, { scroll: false });
  }

  if (isLoading) return <Pad>Loading…</Pad>;
  if (!catalog || !meta || !schemaMeta)
    return (
      <Pad>
        Table {schema ? `${schema}.` : ""}
        {params.table} not found on "{params.connection}".{" "}
        <Link href={backHref} className="underline">
          Back
        </Link>
      </Pad>
    );

  const connectionNameById = new Map(catalog.connections.map((c) => [c.connectionId, c.connectionName]));
  const resolveConnectionName = (id: string) => connectionNameById.get(id) ?? id;
  // Override-aware view (hidden/readonly/redacted) of each raw column, so the
  // "Key / customization" column can show what Customize actually did.
  const colMetaByName = new Map(meta.columns.map((cm) => [cm.col.name, cm]));

  const focusId = `${meta.resolvedSchema}.${meta.table.name}`;
  const neighborGraph = buildNeighborGraph(meta.connectionId, meta.resolvedSchema, schemaMeta, meta.table.name);

  // Clicking the centered table is a no-op (already here); a neighbor
  // re-centers on that table's own Info/Graph tab, so you walk the schema
  // one hop at a time instead of parsing a whole schema graph at once.
  function onNodeClick(node: GraphNode) {
    if (node.id === focusId) return;
    router.push(infoHref({ connection: params.connection, schema: node.schema, table: node.table, tab: "graph" }));
  }

  return (
    <div className="px-8 py-7">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: params.connection, link: `/browse/${params.connection}` },
          { label: meta.label, link: backHref },
          { label: "Info" },
        ]}
      />

      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold">{meta.label}</h1>
            {meta.isView && (
              <span className="tag" style={{ color: "var(--warning)" }}>
                view · read-only
              </span>
            )}
          </div>
          {meta.table.comment && (
            <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              {meta.table.comment}
            </p>
          )}
          <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
            ≈{meta.table.rowEstimate.toLocaleString()} rows
          </p>
        </div>
        <Button
          variant="secondary"
          nativeButton={false}
          render={
            <Link href={customizeHref({ connection: params.connection, schema: meta.schema, table: params.table })} />
          }
        >
          <Settings2 className="size-3.5" /> Customize
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as InfoTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>

        <TabsContent value="columns" className="space-y-4">
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left px-3 py-2 font-medium">Column</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Nullable</th>
                  <th className="text-left px-3 py-2 font-medium">Default</th>
                  <th className="text-left px-3 py-2 font-medium">Generated</th>
                  <th className="text-left px-3 py-2 font-medium">Comment</th>
                  <th className="text-left px-3 py-2 font-medium">Key / customization</th>
                </tr>
              </thead>
              <tbody>
                {meta.table.columns.map((col) => {
                  const cm = colMetaByName.get(col.name);
                  const typeDetail = col.enumValues?.length
                    ? `enum: ${col.enumValues.join(", ")}`
                    : col.numeric
                      ? `precision ${col.numeric.precision ?? "—"}, scale ${col.numeric.scale ?? "—"}${col.numeric.unsigned ? ", unsigned" : ""}`
                      : col.maxLength
                        ? `max length ${col.maxLength}`
                        : null;
                  return (
                    <tr key={col.name} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-3 py-2 code">{col.name}</td>
                      <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>
                        <div>{col.dataType}</div>
                        {typeDetail && (
                          <div className="text-[11px]" style={{ color: "var(--muted-foreground-faint)" }}>
                            {typeDetail}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>
                        {col.nullable ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 code" style={{ color: "var(--muted-foreground-faint)" }}>
                        {col.default ?? "—"}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>
                        {col.isGenerated ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>
                        {col.comment ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {meta.table.primaryKey.includes(col.name) && <span className="tag">PK</span>}
                          {cm?.hidden && (
                            <span className="tag" style={{ color: "var(--muted-foreground)" }}>
                              hidden
                            </span>
                          )}
                          {cm?.readonly && (
                            <span className="tag" style={{ color: "var(--muted-foreground)" }}>
                              readonly
                            </span>
                          )}
                          {cm?.redacted && (
                            <span className="tag" style={{ color: "var(--destructive)" }}>
                              redacted
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: "var(--muted-foreground-faint)" }}
            >
              Table customization
            </div>
            {!meta.tableOverride ? (
              <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                No table-level customization —{" "}
                <Link
                  href={customizeHref({ connection: params.connection, schema: meta.schema, table: params.table })}
                  className="underline"
                >
                  configure in Customize
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 text-[12px]">
                {meta.tableOverride.label && <span className="tag">label: {meta.tableOverride.label}</span>}
                {meta.tableOverride.hidden && <span className="tag">hidden</span>}
                {meta.tableOverride.searchable === false && <span className="tag">not searchable</span>}
                {meta.tableOverride.displayColumn && (
                  <span className="tag">display column: {meta.tableOverride.displayColumn}</span>
                )}
                {meta.tableOverride.defaultSort && (
                  <span className="tag">
                    default sort: {meta.tableOverride.defaultSort} {meta.tableOverride.defaultSortDir ?? "asc"}
                  </span>
                )}
                {meta.tableOverride.primaryKey?.length && (
                  <span className="tag">configured key: {meta.tableOverride.primaryKey.join(", ")}</span>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="constraints">
          <Card className="p-4 grid sm:grid-cols-2 gap-4">
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Primary key
              </div>
              {meta.table.primaryKey.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                  None{meta.tableOverride?.primaryKey?.length ? " (using a configured key, see Customize)" : "."}
                </p>
              ) : (
                <span className="tag">{meta.table.primaryKey.join(", ")}</span>
              )}
            </div>

            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Unique constraints
              </div>
              {meta.table.uniqueConstraints.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                  None.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {meta.table.uniqueConstraints.map((cols, i) => (
                    <span key={i} className="tag">
                      {cols.join(", ")}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Check constraints
              </div>
              {meta.table.checkConstraints.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                  None.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {meta.table.checkConstraints.map((c) => (
                    <div key={c.name} className="text-[11.5px] code wrap-break-word">
                      {c.name}: {c.expression}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--muted-foreground-faint)" }}
              >
                Indexed columns
              </div>
              {meta.table.indexedColumns.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: "var(--muted-foreground-faint)" }}>
                  None known.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {meta.table.indexedColumns.map((c) => (
                    <span key={c} className="tag">
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
                Columns covered by some index — not a full index list (name/uniqueness/order aren't tracked yet).
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="relationships">
          <ForeignKeyLists
            table={meta.table}
            schemaTables={schemaMeta.tables}
            virtualFks={meta.virtualFks}
            resolveConnectionName={resolveConnectionName}
          />
        </TabsContent>

        <TabsContent value="graph">
          <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <RelationshipDiagram graph={neighborGraph} focusId={focusId} height={760} onNodeClick={onNodeClick} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-8 py-10 text-[14px]" style={{ color: "var(--muted-foreground)" }}>
      {children}
    </div>
  );
}
