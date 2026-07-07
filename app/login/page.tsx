"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: setup } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["needs-setup"],
    queryFn: async () => (await fetch("/api/auth/setup")).json(),
  });
  const needsSetup = setup?.needsSetup;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const endpoint = needsSetup ? "/api/auth/setup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsSetup ? { email, password, name } : { email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed");
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <div className="panel p-7 w-[380px] max-w-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🦎</span>
          <span className="text-lg font-semibold tracking-tight">Lizard</span>
        </div>
        <p className="text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
          {needsSetup ? "Create the first admin account to get started." : "Sign in to your data console."}
        </p>

        <div className="space-y-3">
          {needsSetup && (
            <div>
              <label className="label">Name (optional)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div>
            <label className="label">Password{needsSetup && " (min 8 characters)"}</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-[13px]" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        )}

        <Button
          className="w-full justify-center mt-5"

          disabled={busy || !email || !password}
          onClick={submit}
        >
          {busy ? "…" : needsSetup ? "Create admin & sign in" : "Sign in"}
        </Button>
      </div>
    </div>
  );
}
