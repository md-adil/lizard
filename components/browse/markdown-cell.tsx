import { marked } from "marked";
import { NullValue } from "@/components/browse/null-value";

export interface MarkdownCellProps {
  value: unknown;
  className?: string;
}

export function MarkdownCell({ value, className }: MarkdownCellProps) {
  const text = String(value || "");
  if (!text) return <NullValue />;

  let rendered = "";
  try {
    rendered = String(marked.parse(text, { async: false }));
  } catch {
    rendered = text;
  }

  return (
    <div
      className={className}
      style={{ fontSize: "12.5px", lineHeight: "1.4" }}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
