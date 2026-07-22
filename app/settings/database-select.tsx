"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

interface DatabaseSelectProps {
  value: string;
  onChange: (databaseName: string) => void;
  connectionId?: string;
  engine: string;
  host: string;
  port: string;
  readUser: string;
  readPassword?: string;
  ssl: boolean;
  options?: string | null;
}

export function DatabaseSelect({
  value,
  onChange,
  connectionId,
  engine,
  host,
  port,
  readUser,
  readPassword,
  ssl,
  options,
}: DatabaseSelectProps) {
  const [dbOptions, setDbOptions] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const scan = async () => {
    if (!host || !readUser) return;
    setDiscovering(true);
    try {
      const res = await fetch("/api/connections/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          engine,
          host,
          port: Number(port),
          user: readUser,
          password: readPassword,
          ssl,
          options,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        setDbOptions(body);
      }
    } catch {
      // ignore
    } finally {
      setDiscovering(false);
    }
  };

  // Run automatically on mount/initially if source ID is available
  useEffect(() => {
    if (connectionId) {
      scan();
    }
  }, [connectionId]);

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between mb-1.5">
        <label className="label mb-0">Database</label>
        {dbOptions.length > 0 ? (
          <span className="text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">
            ✓ {dbOptions.length} databases found
          </span>
        ) : discovering ? (
          <span className="text-[12px] text-muted-foreground animate-pulse font-medium">
            Scanning host databases...
          </span>
        ) : (
          <button
            type="button"
            onClick={scan}
            className="text-[11px] font-medium hover:underline transition-all"
            style={{ color: "var(--primary)" }}
          >
            Scan for other databases
          </button>
        )}
      </div>

      {dbOptions.length > 0 ? (
        <Combobox
          value={value}
          items={dbOptions}
          onValueChange={(val) => {
            if (val) onChange(val);
          }}
        >
          <ComboboxInput
            placeholder="Select or type database name"
            className="w-full"
            onChange={(e) => onChange(e.target.value)}
          />
          <ComboboxContent className="min-w-[calc(var(--anchor-width))]">
            <ComboboxEmpty>No databases found</ComboboxEmpty>
            <ComboboxList>
              {dbOptions.map((db) => (
                <ComboboxItem key={db} value={db}>
                  {db}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select or type database name" />
      )}
    </div>
  );
}
