"use client";

// Full-page table customization: table + column overrides and virtual
// relationships. Source scope (this schema, or a schema pattern like org_*
// that applies the whole page to every matching tenant schema) is owned here
// since it governs both halves of the page.
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTableMeta } from "@/components/browse/useTableMeta";
import { useCatalog } from "@/components/browse/use-catalog";
import { useConnectionSchemas } from "@/components/browse/use-connection-schemas";
import { resolveTableOverride } from "@/lib/introspect/overrides";
import { SAME_SCHEMA, matchesGlob, isPattern } from "@/lib/introspect/virtual-fk";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { TableOverridesEditor } from "./table-overrides-editor";
import { VirtualFkEditor } from "./virtual-fk-editor";
import { useSchemaParam, tableHref } from "@/components/browse/use-schema-param";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function CustomizePage() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const qc = useQueryClient();
  const schema = useSchemaParam();
  const { meta, catalog, schemaMeta, isLoading } = useTableMeta(params.connection, schema, params.table);
  // Called unconditionally (rules of hooks) even though it's only used in
  // pattern mode below — cheap either way, and this page is inherently
  // scoped to one already-selected connection.
  const { schemas: connSchemas } = useConnectionSchemas(params.connection);

  const [explicitScope, setExplicitScope] = useState<"schema" | "pattern" | null>(null);
  const [explicitPattern, setExplicitPattern] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"settings" | "grid" | "columns" | "relationships">("settings");

  const backHref = tableHref({ connection: params.connection, schema: meta?.schema ?? schema, table: params.table });

  if (isLoading) return <Pad>Loading…</Pad>;
  if (!catalog || !meta || !schemaMeta)
    return (
      <Pad>
        Table {schema ? `${schema}.` : ""}
        {params.table} not found on “{params.connection}”.{" "}
        <Link href={backHref} className="underline">
          Back
        </Link>
      </Pad>
    );

  const patternTableOverride = resolveTableOverride(
    schemaMeta.tableOverrides.filter((o) => isPattern(o.schema)),
    meta.connectionId,
    meta.resolvedSchema,
    meta.table.name,
  );
  const detectedPattern =
    patternTableOverride?.schema ?? meta.virtualFks.find((v) => isPattern(v.fromSchema))?.fromSchema ?? null;

  // Schema patterns (multi-tenant "org_*" style overrides) only mean something
  // where schemas do — MySQL/Mongo have exactly one, so there's nothing to
  // match a pattern across. `meta.schema` being set is that test.
  const hasSchema = meta.schema !== undefined;
  const scope = hasSchema ? (explicitScope ?? (detectedPattern ? "pattern" : "schema")) : "schema";
  const pattern = hasSchema ? (explicitPattern ?? detectedPattern ?? "") : "";

  const saveSchema = scope === "pattern" && pattern ? pattern : meta.resolvedSchema;
  const matchedSchemas =
    scope === "pattern" && pattern ? connSchemas.filter((s) => matchesGlob(pattern, s.name)).map((s) => s.name) : [];

  function invalidate() {
    useCatalog.invalidate(qc);
    qc.invalidateQueries({ queryKey: ["schema-meta", meta!.connection] });
    qc.invalidateQueries({
      queryKey: ["rows", meta!.connection, meta!.schema, meta!.table.name],
    });
  }

  return (
    <div className="px-8 py-7">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: "Home", link: "/" },
          { label: params.connection, link: `/browse/${params.connection}` },
          {
            label: meta.label,
            link: tableHref({ connection: params.connection, schema: meta.schema, table: meta.table.name }),
          },
          { label: "Customization" },
        ]}
      />
      {hasSchema && meta.schema !== "public" && (
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              Applies to:
            </span>
            <Chip active={scope === "schema"} onClick={() => setExplicitScope("schema")}>
              This schema ({meta.schema})
            </Chip>
            <Chip active={scope === "pattern"} onClick={() => setExplicitScope("pattern")}>
              Schema pattern
            </Chip>
            {scope === "pattern" && (
              <Input
                className="w-64"
                placeholder="e.g. org_*"
                value={pattern}
                onChange={(e) => setExplicitPattern(e.target.value)}
              />
            )}
          </div>
          {scope === "pattern" && (
            <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
              {pattern
                ? `matches ${matchedSchemas.length}: ${matchedSchemas.slice(0, 8).join(", ")}${matchedSchemas.length > 8 ? "…" : ""}`
                : "everything on this page is saved once and applied to every matching schema. Exact per-schema overrides still win."}
            </p>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="grid">Grid</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
        </TabsList>

        <TableOverridesEditor
          meta={meta}
          tableOverrides={schemaMeta.tableOverrides}
          columnOverrides={schemaMeta.columnOverrides}
          scope={scope}
          saveSchema={saveSchema}
          onSaved={invalidate}
        />

        <TabsContent value="relationships">
          <p className="text-[12.5px] mb-3" style={{ color: "var(--muted-foreground)" }}>
            Link this table to another — composite keys, constant filters, case-insensitive matches. Powers reference
            labels/pickers and tells the AI how to join.
          </p>
          <VirtualFkEditor
            meta={meta}
            catalog={catalog}
            schemaTables={schemaMeta.tables}
            fromSchema={saveSchema}
            fromTable={meta.table.name}
            defaultToSchema={scope === "pattern" ? SAME_SCHEMA : meta.resolvedSchema}
            onSaved={invalidate}
          />
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
