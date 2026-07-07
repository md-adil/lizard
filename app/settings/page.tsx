"use client";

import { useAuth } from "@/components/auth-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConnectionsTab } from "./connections-tab";
import { UsersTab } from "./users-tab";

export default function SettingsPage() {
  const { isAdmin } = useAuth();

  return (
    <div className="max-w-4xl px-8 py-10">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="users" disabled={!isAdmin}>
            Users
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
      </Tabs>
    </div>
  );
}
