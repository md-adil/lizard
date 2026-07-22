import { Badge } from "@/components/ui/badge";
import { NullValue } from "@/components/browse/null-value";

export interface TagCellProps {
  // the server normalizes a "tag" widget column to string[] on every read
  // (see normalizeTagColumns in app/api/data/crud.ts) — no need to defend
  // against a raw JSON string or other shape here.
  value: string[];
  className?: string;
}

function getTagStyles(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const palettes = [
    { bg: "bg-blue-500/10 text-blue-500 border-blue-500/20 dark:bg-blue-500/20" },
    { bg: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 dark:bg-emerald-500/20" },
    { bg: "bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/20" },
    { bg: "bg-rose-500/10 text-rose-500 border-rose-500/20 dark:bg-rose-500/20" },
    { bg: "bg-purple-500/10 text-purple-500 border-purple-500/20 dark:bg-purple-500/20" },
    { bg: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20 dark:bg-indigo-500/20" },
    { bg: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20 dark:bg-cyan-500/20" },
    { bg: "bg-orange-500/10 text-orange-500 border-orange-500/20 dark:bg-orange-500/20" },
  ];

  const index = Math.abs(hash) % palettes.length;
  return palettes[index];
}

export function TagCell({ value, className }: TagCellProps) {
  if (value.length === 0) return <NullValue />;

  return (
    <div className="flex flex-wrap gap-1">
      {value.map((tag) => {
        const styles = getTagStyles(tag);
        return (
          <Badge
            key={tag}
            variant="outline"
            className={`${styles.bg} font-semibold px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider select-none shrink-0 border ${className || ""}`}
          >
            {tag}
          </Badge>
        );
      })}
    </div>
  );
}
