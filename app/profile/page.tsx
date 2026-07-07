"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();

  const [name, setName] = useState(user?.name ?? "");
  const [nameSuccess, setNameSuccess] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const nameMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      return body;
    },
    onSuccess: () => {
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
      refresh();
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword)
        throw new Error("Passwords do not match");
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      return body;
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
      setTimeout(() => setPasswordSuccess(false), 3000);
    },
  });

  if (!user) return null;

  return (
    <div className="px-8 py-10 max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">Profile</h1>
      <p className="text-[13px] mb-6" style={{ color: "var(--muted-foreground)" }}>
        Manage your account details and password.
      </p>

      {/* Row 1: Account info — full width */}
      <div className="panel px-6 py-5 mb-4">
        <p
          className="text-[12px] font-semibold uppercase tracking-wide mb-3"
          style={{ color: "var(--muted-foreground-faint)" }}
        >
          Account
        </p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="label">Email</label>
            <div className="input opacity-60">{user.email}</div>
          </div>
          <div>
            <label className="label">Role</label>
            <div className="input opacity-60 capitalize">{user.role}</div>
          </div>
        </div>
      </div>

      {/* Row 2: Name + Password side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="panel px-6 py-5">
          <p
            className="text-[12px] font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            Display name
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              nameMutation.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            {nameMutation.error && (
              <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
                {(nameMutation.error as Error).message}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={nameMutation.isPending}>
                {nameMutation.isPending ? "Saving…" : "Save name"}
              </Button>
              {nameSuccess && (
                <span className="text-[12px]" style={{ color: "var(--success)" }}>
                  Saved ✓
                </span>
              )}
            </div>
          </form>
        </div>

        <div className="panel px-6 py-5">
          <p
            className="text-[12px] font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--muted-foreground-faint)" }}
          >
            Change password
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              passwordMutation.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {passwordMutation.error && (
              <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
                {(passwordMutation.error as Error).message}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  passwordMutation.isPending ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
              >
                {passwordMutation.isPending ? "Updating…" : "Update password"}
              </Button>
              {passwordSuccess && (
                <span className="text-[12px]" style={{ color: "var(--success)" }}>
                  Password updated ✓
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
