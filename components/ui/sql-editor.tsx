"use client";

// Lightweight code syntax highlighting: react-simple-code-editor renders a
// highlighted <pre> under a transparent <textarea>, so these behave exactly
// like a controlled Textarea — just colored. Token colors live in
// globals.css (.code-highlight) on the app's CSS variables, so they follow
// the theme. For a real editor (schema-aware autocomplete, bracket
// matching), the upgrade path is CodeMirror 6 + @codemirror/lang-*.
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-json";

import { WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CodeLanguage = "sql" | "json";

function highlightCode(code: string, language: CodeLanguage): string {
  return Prism.highlight(code, Prism.languages[language], language);
}

function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  minRows = 4,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  minRows?: number;
  className?: string;
}) {
  return (
    // resize-y + overflow-auto turn this into a textarea-like drag handle in
    // the bottom-right corner — height only (the editor is always w-full).
    // The Editor's own minHeight:100% makes it fill whatever height the box
    // currently has, whether that's the initial minRows-based one or
    // whatever the user dragged it to.
    <div
      className={cn(
        "code-highlight code w-full resize-y overflow-auto rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
      style={{ minHeight: minRows * 20 + 20 }}
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={(code) => highlightCode(code, language)}
        placeholder={placeholder}
        padding={10}
        textareaClassName="outline-none placeholder:text-muted-foreground"
        style={{ fontFamily: "var(--mono)", fontSize: 12.5, minHeight: "100%" }}
      />
    </div>
  );
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
    <CodeEditor
      value={value}
      onChange={onChange}
      language="sql"
      placeholder={placeholder}
      minRows={minRows}
      className={className}
    />
  );
}

export function SqlCode({ sql, className }: { sql: string; className?: string }) {
  return (
    <pre
      className={cn("code-highlight code whitespace-pre-wrap", className)}
      // Prism.highlight escapes the input; the only HTML here is Prism's own
      // token <span>s.
      dangerouslySetInnerHTML={{ __html: highlightCode(sql, "sql") }}
    />
  );
}

export function JsonEditor({
  value,
  onChange,
  placeholder,
  minRows = 4,
  className,
}: {
  value: string;
  onChange: (json: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}) {
  const trimmed = value.trim();
  let valid = true;
  if (trimmed !== "") {
    try {
      JSON.parse(trimmed);
    } catch {
      valid = false;
    }
  }

  const format = () => {
    if (!valid || trimmed === "") return;
    onChange(JSON.stringify(JSON.parse(trimmed), null, 2));
  };

  return (
    <div className={cn("relative", className)}>
      <CodeEditor value={value} onChange={onChange} language="json" placeholder={placeholder} minRows={minRows} />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1 right-1"
        title="Format JSON"
        aria-label="Format JSON"
        disabled={!valid || trimmed === ""}
        onClick={format}
      >
        <WandSparkles />
      </Button>
    </div>
  );
}
