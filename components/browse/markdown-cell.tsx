import { marked } from "marked";

export interface MarkdownCellProps {
  value: unknown;
  className?: string;
}

export function MarkdownCell({ value, className }: MarkdownCellProps) {
  const text = String(value || "");
  if (!text) return <span className="text-muted-foreground">∅</span>;

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
