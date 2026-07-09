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
import { SAME_SCHEMA, matchesGlob, isPattern } from "@/lib/introspect/virtual-fk";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableOverridesEditor } from "./table-overrides-editor";
import { VirtualFkEditor } from "./virtual-fk-editor";
import { useSchemaParam, tableHref } from "@/components/browse/use-schema-param";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbItem,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

export default function CustomizePage() {
  const params = useParams<{
    connection: string;
    table: string;
  }>();
  const qc = useQueryClient();
  const schema = useSchemaParam();
  const { meta, catalog, schemaMeta, isLoading } = useTableMeta(params.connection, schema, params.table);

  // page-level source scope — governs both the overrides and the
  // relationship editor's source side. `null` means "not yet touched by the
  // user" so it falls back to whatever pattern already governs this table
  // (detected below) instead of always defaulting to the exact schema.
  const [explicitScope, setExplicitScope] = useState<"schema" | "pattern" | null>(null);
  const [explicitPattern, setExplicitPattern] = useState<string | null>(null);

  const backHref = tableHref({ connection: params.connection, schema: meta?.schema ?? schema, table: params.table });

  if (isLoading) return <Pad>Loading…</Pad>;
  if (!catalog || !meta || !schemaMeta)
    return (
      <Pad>
        Table {schema ? `${schema}.` : ""}{params.table} not found on “{params.connection}”.{" "}
        <Link href={backHref} className="underline">
          Back
        </Link>
      </Pad>
    );

  // A pattern already governs this table if the winning table override or any
  // existing relationship resolved through a glob rather than an exact match
  // — resolveTableOverride/vfkMatchesSource hand back the stored schema string
  // as-is, so we just check whether that string is a pattern.
  const detectedPattern =
    (meta.tableOverride && isPattern(meta.tableOverride.schema) ? meta.tableOverride.schema : null) ??
    meta.virtualFks.find((v) => isPattern(v.fromSchema))?.fromSchema ??
    null;

  // Schema patterns (multi-tenant "org_*" style overrides) only mean something
  // where schemas do — MySQL/Mongo have exactly one, so there's nothing to
  // match a pattern across. `meta.schema` being set is that test.
  const hasSchema = meta.schema !== undefined;
  const scope = hasSchema ? (explicitScope ?? (detectedPattern ? "pattern" : "schema")) : "schema";
  const pattern = hasSchema ? (explicitPattern ?? detectedPattern ?? "") : "";

  const saveSchema = scope === "pattern" && pattern ? pattern : meta.resolvedSchema;
  const matchedSchemas =
    scope === "pattern" && pattern
      ? (catalog.connections
          .find((c) => c.connectionName === params.connection)
          ?.schemas.filter((s) => matchesGlob(pattern, s.name))
          .map((s) => s.name) ?? [])
      : [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["schema-meta", meta!.connection] });
    qc.invalidateQueries({
      queryKey: ["rows", meta!.connection, meta!.schema, meta!.table.name],
    });
  }

  return (
    <div className="px-8 py-7 max-w-6xl">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={`/browse/${params.connection}`} />}>{params.connection}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <Link href={tableHref({ connection: params.connection, schema: meta.schema, table: meta.table.name })} />
              }
            >
              {meta.label}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Customization</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {hasSchema && (
        <>
          <Tabs value={scope} onValueChange={(v) => setExplicitScope(v as "schema" | "pattern")} className="mb-4">
            <TabsList variant="line">
              <TabsTrigger value="schema">This schema ({meta.schema})</TabsTrigger>
              <TabsTrigger value="pattern">Schema pattern</TabsTrigger>
            </TabsList>
          </Tabs>
          {scope === "pattern" && (
            <div className="mb-6">
              <input
                className="input"
                placeholder="schema pattern, e.g. org_*"
                value={pattern}
                onChange={(e) => setExplicitPattern(e.target.value)}
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground-faint)" }}>
                {pattern
                  ? `matches ${matchedSchemas.length}: ${matchedSchemas.slice(0, 8).join(", ")}${matchedSchemas.length > 8 ? "…" : ""}`
                  : "everything on this page is saved once and applied to every matching schema. Exact per-schema overrides still win."}
              </p>
            </div>
          )}
        </>
      )}

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <TableOverridesEditor
          meta={meta}
          columnOverrides={schemaMeta.columnOverrides}
          saveSchema={saveSchema}
          onSaved={invalidate}
        />
        <div>
          <SectionTitle>Virtual relationships</SectionTitle>
          <p className="text-[12.5px] mb-3" style={{ color: "var(--muted-foreground)" }}>
            Link this table to another — composite keys, constant filters, case-insensitive matches. Powers reference
            labels/pickers and tells the AI how to join.
          </p>
          <VirtualFkEditor
            meta={meta}
            catalog={catalog}
            fromSchema={saveSchema}
            fromTable={meta.table.name}
            defaultToSchema={scope === "pattern" ? SAME_SCHEMA : meta.resolvedSchema}
            onSaved={invalidate}
          />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[12px] font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--muted-foreground-faint)" }}
    >
      {children}
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
