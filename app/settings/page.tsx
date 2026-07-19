"use client";

import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ConnectionsTab } from "./connections-tab";
import { UsersTab } from "./users-tab";
import { AuditTab } from "./audit-tab";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  // ?tab=audit — used by the /audit redirect so old bookmarks land on the tab
  const initialTab = useSearchParams().get("tab") ?? "connections";

  return (
    <div className="max-w-5xl px-8 py-10">
      <Breadcrumbs className="mb-4" items={[{ label: "Home", link: "/" }, { label: "Settings" }]} />
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="users" disabled={!isAdmin}>
            Users
          </TabsTrigger>
          <TabsTrigger value="audit" disabled={!isAdmin}>
            Audit log
          </TabsTrigger>
        </TabsList>
        <TabsContent value="connections" className="w-full mt-6">
          <ConnectionsTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="users" className="w-full mt-6">
            <UsersTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="audit" className="w-full mt-6">
            <AuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
