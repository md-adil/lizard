"use client";

import { useParams } from "next/navigation";
import { TableCustomizer } from "./table-customizer";

export default function CustomizePage() {
  const params = useParams<{
    connection: string;
    schema: string;
    table: string;
  }>();
  return (
    <TableCustomizer
      connection={params.connection}
      schema={params.schema}
      table={params.table}
    />
  );
}
