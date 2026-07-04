"use client";

import { createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type Role = "admin" | "editor" | "viewer";
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  isEditor: boolean; // admin or editor
  refresh: () => void;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  isAdmin: false,
  isEditor: false,
  refresh: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ user: AuthUser | null }>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return { user: null };
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });
  const user = data?.user ?? null;
  return (
    <AuthContext.Provider
      value={{
        user,
        loading: isLoading,
        isAdmin: user?.role === "admin",
        isEditor: user?.role === "admin" || user?.role === "editor",
        refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
