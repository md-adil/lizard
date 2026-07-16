"use client";

// Lightweight SQL syntax highlighting: react-simple-code-editor renders a
// highlighted <pre> under a transparent <textarea>, so SqlEditor behaves
// exactly like a controlled Textarea — just colored. Token colors live in
// globals.css (.sql-highlight) on the app's CSS variables, so they follow
// the theme. For a real editor (schema-aware autocomplete, bracket
// matching), the upgrade path is CodeMirror 6 + @codemirror/lang-sql.
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-sql";

import { cn } from "@/lib/utils";

function highlightSql(code: string): string {
  return Prism.highlight(code, Prism.languages.sql, "sql");
}

export function SqlEditor({
  value,
  onChange,
  placeholder,
  minRows = 4,
  className,
}: {
  value: string;
  onChange: (sql: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sql-highlight code w-full rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlightSql}
        placeholder={placeholder}
        padding={10}
        textareaClassName="outline-none placeholder:text-muted-foreground"
        style={{ fontFamily: "var(--mono)", fontSize: 12.5, minHeight: minRows * 20 + 20 }}
      />
    </div>
  );
}

export function SqlCode({ sql, className }: { sql: string; className?: string }) {
  return (
    <pre
      className={cn("sql-highlight code whitespace-pre-wrap", className)}
      // Prism.highlight escapes the input; the only HTML here is Prism's own
      // token <span>s.
      dangerouslySetInnerHTML={{ __html: highlightSql(sql) }}
    />
  );
}
